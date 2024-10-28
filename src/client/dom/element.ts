import { SCRAMJETCLIENT } from "../../symbols";
import { ScramjetClient } from "../client";
import { nativeGetOwnPropertyDescriptor } from "../natives";
import {
	unrewriteUrl,
	htmlRules,
	unrewriteHtml,
	unrewriteBlob,
} from "../../shared";
import {
	rewriteUrl,
	rewriteCss,
	rewriteHtml,
	rewriteJs,
	rewriteSrcset,
} from "../../shared";
import type { URLMeta } from "../../shared/rewriters/url";

export default function (client: ScramjetClient, self: typeof window) {
	const _nativeGetAttribute = self.Element.prototype.getAttribute;
	const nativeSetAttribute = self.Element.prototype.setAttribute;
	const _nativeHasAttribute = self.Element.prototype.hasAttribute;

	const attrObject = {
		nonce: [self.HTMLElement],
		integrity: [self.HTMLScriptElement, self.HTMLLinkElement],
		csp: [self.HTMLIFrameElement],
		src: [
			self.HTMLImageElement,
			self.HTMLMediaElement,
			self.HTMLIFrameElement,
			self.HTMLEmbedElement,
			self.HTMLScriptElement,
			self.HTMLSourceElement,
		],
		href: [self.HTMLAnchorElement, self.HTMLLinkElement],
		data: [self.HTMLObjectElement],
		action: [self.HTMLFormElement],
		formaction: [self.HTMLButtonElement, self.HTMLInputElement],
		srcdoc: [self.HTMLIFrameElement],
		srcset: [self.HTMLImageElement, self.HTMLSourceElement],
		imagesrcset: [self.HTMLLinkElement],
	};

	const urlinterfaces = [
		self.HTMLAnchorElement.prototype,
		self.HTMLAreaElement.prototype,
	];
	const originalhrefs = [
		nativeGetOwnPropertyDescriptor(self.HTMLAnchorElement.prototype, "href"),
		nativeGetOwnPropertyDescriptor(self.HTMLAreaElement.prototype, "href"),
	];

	const attrs = Object.keys(attrObject);

	for (const attr of attrs) {
		for (const element of attrObject[attr]) {
			const descriptor = nativeGetOwnPropertyDescriptor(
				element.prototype,
				attr
			);
			Object.defineProperty(element.prototype, attr, {
				get() {
					if (["src", "data", "href", "action", "formaction"].includes(attr)) {
						return unrewriteUrl(descriptor.get.call(this));
					}

					return descriptor.get.call(this);
				},

				set(value) {
					nativeSetAttribute.call(this, "data-scramjet-" + attr, value);
					if (["nonce", "integrity", "csp"].includes(attr)) {
						return;
					} else if (
						["src", "data", "href", "action", "formaction"].includes(attr)
					) {
						if (element === HTMLMediaElement && value.startsWith("blob:")) {
							// mediasource blobs cannot be handled in the service worker and must be sourced here
							value = unrewriteBlob(value);
						} else {
							value = rewriteUrl(value, client.meta);
						}
					} else if (attr === "srcdoc") {
						value = rewriteHtml(
							value,
							client.cookieStore,
							{
								// srcdoc preserves parent origin i think
								base: new URL(client.url.origin),
								origin: new URL(client.url.origin),
							} as URLMeta,
							true
						);
					} else if (["srcset", "imagesrcset"].includes(attr)) {
						value = rewriteSrcset(value, client.meta);
					}

					descriptor.set.call(this, value);
				},
			});
		}
	}

	// note that href is not here
	const urlprops = [
		"protocol",
		"hash",
		"host",
		"hostname",
		"origin",
		"pathname",
		"port",
		"search",
	];
	for (const prop of urlprops) {
		for (const i in urlinterfaces) {
			const target = urlinterfaces[i];
			const desc = originalhrefs[i];
			client.RawTrap(target, prop, {
				get(ctx) {
					const href = desc.get.call(ctx.this);
					if (!href) return href;

					const url = new URL(unrewriteUrl(href));

					return url[prop];
				},
			});
		}
	}

	client.Trap("Node.prototype.baseURI", {
		get() {
			// TODO this should be using ownerdocument but who gaf
			const base = self.document.querySelector("base");
			if (base) {
				return new URL(base.href, client.url.origin).href;
			}

			return client.url.origin;
		},
		set() {
			return false;
		},
	});

	client.Proxy("Element.prototype.setAttribute", {
		apply(ctx) {
			const [name, value] = ctx.args;

			const ruleList = htmlRules.find((rule) => {
				const r = rule[name];
				if (!r) return false;
				if (r === "*") return true;
				if (typeof r === "function") return false; // this can't happen but ts

				return r.includes(ctx.this.tagName.toLowerCase());
			});

			if (ruleList) {
				ctx.args[1] = ruleList.fn(value, client.meta, client.cookieStore);
				ctx.fn.call(ctx.this, `data-scramjet-${ctx.args[0]}`, value);
			}
		},
	});
	client.Proxy("Element.prototype.setAttributeNS", {
		apply(ctx) {
			const [namespace, name, value] = ctx.args;

			const ruleList = htmlRules.find((rule) => {
				const r = rule[name];
				if (!r) return false;
				if (r === "*") return true;
				if (typeof r === "function") return false; // this can't happen but ts

				return r.includes(ctx.this.tagName.toLowerCase());
			});

			if (ruleList) {
				ctx.args[2] = ruleList.fn(value, client.meta, client.cookieStore);
				nativeSetAttribute.call(
					ctx.this,
					`data-scramjet-${ctx.args[1]}`,
					value
				);
			}
		},
	});

	client.Proxy("Element.prototype.getAttribute", {
		apply(ctx) {
			const [name] = ctx.args;

			if (ctx.fn.call(ctx.this, `data-scramjet-${name}`)) {
				ctx.return(ctx.fn.call(ctx.this, `data-scramjet-${name}`));
			}
		},
	});

	client.Trap("Element.prototype.innerHTML", {
		set(ctx, value: string) {
			let newval;
			if (ctx.this instanceof self.HTMLScriptElement) {
				newval = rewriteJs(value, false, client.meta);
			} else if (ctx.this instanceof self.HTMLStyleElement) {
				newval = rewriteCss(value, client.meta);
			} else {
				newval = rewriteHtml(value, client.cookieStore, client.meta);
			}

			ctx.set(newval);
		},
		get(ctx) {
			if (ctx.this instanceof self.HTMLScriptElement) {
				const scriptSource = client.natives[
					"Element.prototype.getAttribute"
				].call(ctx.this, "data-scramjet-script-source-src");

				if (scriptSource) {
					return atob(scriptSource);
				}

				return ctx.get();
			}
			if (ctx.this instanceof self.HTMLStyleElement) {
				return ctx.get();
			}

			return unrewriteHtml(ctx.get());
		},
	});

	client.Trap("Element.prototype.outerHTML", {
		set(ctx, value: string) {
			ctx.set(rewriteHtml(value, client.cookieStore, client.meta));
		},
		get(ctx) {
			return unrewriteHtml(ctx.get());
		},
	});

	client.Proxy("Element.prototype.insertAdjacentHTML", {
		apply(ctx) {
			if (ctx.args[1])
				ctx.args[1] = rewriteHtml(
					ctx.args[1],
					client.cookieStore,
					client.meta,
					false
				);
		},
	});

	client.Trap("HTMLIFrameElement.prototype.contentWindow", {
		get(ctx) {
			const realwin = ctx.get() as Window;
			if (!realwin) return realwin;

			if (SCRAMJETCLIENT in realwin.self) {
				if (realwin.location.href.includes("accounts.google.com")) return null; // don't question it

				return realwin.self[SCRAMJETCLIENT].globalProxy;
			} else {
				// hook the iframe
				const newclient = new ScramjetClient(realwin.self);
				newclient.hook();

				return newclient.globalProxy;
			}
		},
	});

	client.Trap("HTMLIFrameElement.prototype.contentDocument", {
		get(ctx) {
			const contentwindow =
				client.descriptors["HTMLIFrameElement.prototype.contentWindow"].get;
			const realwin = contentwindow.apply(ctx.this);
			if (!realwin) return realwin;

			if (SCRAMJETCLIENT in realwin.self) {
				return realwin.self[SCRAMJETCLIENT].documentProxy;
			} else {
				const newclient = new ScramjetClient(realwin.self);
				newclient.hook();

				return newclient.documentProxy;
			}
		},
	});

	client.Trap("TreeWalker.prototype.currentNode", {
		get(ctx) {
			return ctx.get();
		},
		set(ctx, value) {
			if (value == client.documentProxy) {
				return ctx.set(self.document);
			}

			return ctx.set(value);
		},
	});

	client.Trap("Node.prototype.ownerDocument", {
		get(ctx) {
			// return client.documentProxy;
			const doc = ctx.get() as Document | null;
			if (!doc) return null;

			const scram: ScramjetClient = doc[SCRAMJETCLIENT];
			if (!scram) return doc; // ??

			return scram.documentProxy;
		},
	});

	client.Trap(
		[
			"Node.prototype.parentNode",
			"Node.prototype.parentElement",
			"Node.prototype.previousSibling",
			"Node.prototype.nextSibling",
		],
		{
			get(ctx) {
				const n = ctx.get() as Node;
				if (!(n instanceof Document)) return n;

				const scram: ScramjetClient = n[SCRAMJETCLIENT];
				if (!scram) return n; // ??

				return scram.documentProxy;
			},
		}
	);

	client.Proxy("Node.prototype.getRootNode", {
		apply(ctx) {
			const n = ctx.call() as Node;
			if (!(n instanceof Document)) return ctx.return(n);

			const scram: ScramjetClient = n[SCRAMJETCLIENT];
			if (!scram) return ctx.return(n); // ??

			return ctx.return(scram.documentProxy);
		},
	});

	client.Proxy("DOMParser.prototype.parseFromString", {
		apply(ctx) {
			if (ctx.args[1] === "text/html") {
				ctx.args[0] = rewriteHtml(
					ctx.args[0],
					client.cookieStore,
					client.meta,
					false
				);
			}
		},
	});
}
