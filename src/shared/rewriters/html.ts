import { ElementType, Parser } from "htmlparser2";
import { ChildNode, DomHandler, Element } from "domhandler";
import render from "dom-serializer";
import { URLMeta, rewriteUrl } from "./url";
import { rewriteCss } from "./css";
import { rewriteJs } from "./js";
import { CookieStore } from "../cookie";
import { unrewriteBlob } from "../../shared/rewriters/url";
import { $scramjet } from "../../scramjet";

export function rewriteHtml(
	html: string,
	cookieStore: CookieStore,
	meta: URLMeta,
	fromTop: boolean = false
) {
	const handler = new DomHandler((err, dom) => dom);
	const parser = new Parser(handler);

	parser.write(html);
	parser.end();
	traverseParsedHtml(handler.root, cookieStore, meta);

	function findhead(node) {
		if (node.type === ElementType.Tag && node.name === "head") {
			return node as Element;
		} else if (node.childNodes) {
			for (const child of node.childNodes) {
				const head = findhead(child);
				if (head) return head;
			}
		}

		return null;
	}

	if (fromTop) {
		let head = findhead(handler.root);
		if (!head) {
			head = new Element("head", {}, []);
			handler.root.children.unshift(head);
		}

		const dump = JSON.stringify(cookieStore.dump());
		const injected = `
			self.COOKIE = ${dump};
			self.$scramjet.config = ${JSON.stringify($scramjet.config)};
			if ("document" in self && document?.currentScript) {
				document.currentScript.remove();
			}
		`;

		const script = (src) => new Element("script", { src });

		head.children.unshift(
			script($scramjet.config.files.wasm),
			script($scramjet.config.files.shared),
			script("data:application/javascript;base64," + btoa(injected)),
			script($scramjet.config.files.client)
		);
	}

	return render(handler.root);
}

// type ParseState = {
// 	base: string;
// 	origin?: URL;
// };

export function unrewriteHtml(html: string) {
	const handler = new DomHandler((err, dom) => dom);
	const parser = new Parser(handler);

	parser.write(html);
	parser.end();

	function traverse(node: ChildNode) {
		if ("attribs" in node) {
			for (const key in node.attribs) {
				if (key == "data-scramjet-script-source-src") {
					if (node.children[0] && "data" in node.children[0])
						node.children[0].data = atob(node.attribs[key]);
					continue;
				}

				if (key.startsWith("data-scramjet-")) {
					node.attribs[key.slice(13)] = node.attribs[key];
					delete node.attribs[key];
				}
			}
		}

		if ("childNodes" in node) {
			for (const child of node.childNodes) {
				traverse(child);
			}
		}
	}

	traverse(handler.root);

	return render(handler.root);
}

export const htmlRules: {
	[key: string]: "*" | string[] | ((...any: any[]) => string | null);
	fn: (value: string, meta: URLMeta, cookieStore: CookieStore) => string | null;
}[] = [
	{
		fn: (value: string, meta: URLMeta) => {
			return rewriteUrl(value, meta);
		},

		// url rewrites
		src: ["embed", "img", "image", "iframe", "source", "input", "track"],
		href: ["a", "link", "area", "use"],
		data: ["object"],
		action: ["form"],
		formaction: ["button", "input", "textarea", "submit"],
		poster: ["video"],
		"xlink:href": ["image"],
	},
	{
		fn: (value: string, meta: URLMeta) => {
			if (value.startsWith("blob:")) {
				// for media elements specifically they must take the original blob
				// because they can't be fetch'd
				return unrewriteBlob(value);
			}

			return rewriteUrl(value, meta);
		},
		src: ["video", "audio"],
	},
	{
		fn: () => null,

		// csp stuff that must be deleted
		nonce: "*",
		crossorigin: "*",
		integrity: ["script", "link"],
		csp: ["iframe"],
	},
	{
		fn: (value: string, meta: URLMeta) => rewriteSrcset(value, meta),

		// srcset
		srcset: ["img", "source"],
		srcSet: ["img", "source"],
		imagesrcset: ["link"],
	},
	{
		fn: (value: string, meta: URLMeta, cookieStore: CookieStore) =>
			rewriteHtml(
				value,
				cookieStore,
				{
					// for srcdoc origin is the origin of the page that the iframe is on. base and path get dropped
					origin: new URL(meta.origin.origin),
					base: new URL(meta.origin.origin),
				},
				true
			),

		// srcdoc
		srcdoc: ["iframe"],
	},
	{
		fn: (value: string, meta: URLMeta) => rewriteCss(value, meta),
		style: "*",
	},
	{
		fn: (value: string) => {
			if (["_parent", "_top", "_unfencedTop"].includes(value)) return "_self";
		},
		target: ["a", "base"],
	},
];

// i need to add the attributes in during rewriting

function traverseParsedHtml(
	node: any,
	cookieStore: CookieStore,
	meta: URLMeta
) {
	if (node.name === "base" && node.attribs.href !== undefined) {
		meta.base = new URL(node.attribs.href, meta.origin);
	}

	if (node.attribs)
		for (const rule of htmlRules) {
			for (const attr in rule) {
				const sel = rule[attr];
				if (typeof sel === "function") continue;

				if (sel === "*" || sel.includes(node.name)) {
					if (node.attribs[attr] !== undefined) {
						const value = node.attribs[attr];
						const v = rule.fn(value, meta, cookieStore);

						if (v === null) delete node.attribs[attr];
						else {
							node.attribs[attr] = v;
						}
						node.attribs[`data-scramjet-${attr}`] = value;
					}
				}
			}
		}

	if (node.name === "style" && node.children[0] !== undefined)
		node.children[0].data = rewriteCss(node.children[0].data, meta);

	if (
		node.name === "script" &&
		/(application|text)\/javascript|module|importmap|undefined/.test(
			node.attribs.type
		)
	) {
		if (node.children[0] !== undefined) {
			let js = node.children[0].data;
			// node.attribs[`data-scramjet-script-source-src`] = btoa(js);
			node.attribs["data-scramjet-script-source-src"] = bytesToBase64(
				new TextEncoder().encode(js)
			);
			const htmlcomment = /<!--[\s\S]*?-->/g;
			js = js.replace(htmlcomment, "");
			node.children[0].data = rewriteJs(
				js,
				node.attribs["type"] === "module",
				meta
			);
		} else if (node.attribs["src"]) {
			let url = rewriteUrl(node.attribs["src"], meta);
			if (node.attribs["type"] === "module") url += "?type=module";

			node.attribs["data-scramjet-src"] = node.attribs["src"];
			node.attribs["src"] = url;
		}
	}

	if (node.name === "meta" && node.attribs["http-equiv"] != undefined) {
		if (
			node.attribs["http-equiv"].toLowerCase() === "content-security-policy"
		) {
			node = {};
		} else if (
			node.attribs["http-equiv"] === "refresh" &&
			node.attribs.content.includes("url")
		) {
			const contentArray = node.attribs.content.split("url=");
			if (contentArray[1])
				contentArray[1] = rewriteUrl(contentArray[1].trim(), meta);
			node.attribs.content = contentArray.join("url=");
		}
	}

	if (node.childNodes) {
		for (const childNode in node.childNodes) {
			node.childNodes[childNode] = traverseParsedHtml(
				node.childNodes[childNode],
				cookieStore,
				meta
			);
		}
	}

	return node;
}

export function rewriteSrcset(srcset: string, meta: URLMeta) {
	const urls = srcset.split(/ [0-9]+x,? ?/g);
	if (!urls) return "";
	const sufixes = srcset.match(/ [0-9]+x,? ?/g);
	if (!sufixes) return "";
	const rewrittenUrls = urls.map((url, i) => {
		if (url && sufixes[i]) {
			return rewriteUrl(url, meta) + sufixes[i];
		}
	});

	return rewrittenUrls.join("");
}

// function base64ToBytes(base64) {
// 	const binString = atob(base64);

// 	return Uint8Array.from(binString, (m) => m.codePointAt(0));
// }

function bytesToBase64(bytes: Uint8Array) {
	const binString = Array.from(bytes, (byte) =>
		String.fromCodePoint(byte)
	).join("");

	return btoa(binString);
}
