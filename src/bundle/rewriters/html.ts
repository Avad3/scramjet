import { Parser } from "htmlparser2";
import { DomHandler, Element } from "domhandler";
import { hasAttrib } from "domutils";
import render from "dom-serializer";
import { encodeUrl } from "./url";
import { rewriteCss } from "./css";
import { rewriteJs } from "./js";
import { isScramjetFile } from "../";

export function rewriteHtml(html: string, origin?: URL) {
    const handler = new DomHandler((err, dom) => dom);
    const parser = new Parser(handler);

    parser.write(html);
    parser.end();

    return render(traverseParsedHtml(handler.root, origin));
}

// i need to add the attributes in during rewriting

function traverseParsedHtml(node, origin?: URL) {
    /* csp attributes */
    if (hasAttrib(node, "nonce")) delete node.attribs.nonce;
    if (hasAttrib(node, "integrity")) delete node.attribs.integrity;
    if (hasAttrib(node, "csp")) delete node.attribs.csp;

    /* url attributes */
    if (hasAttrib(node, "src") && !isScramjetFile(node.attribs.src)) node.attribs.src = encodeUrl(node.attribs.src, origin);
    if (hasAttrib(node, "href")) node.attribs.href = encodeUrl(node.attribs.href, origin);
    if (hasAttrib(node, "data")) node.attribs.data = encodeUrl(node.attribs.data, origin);
    if (hasAttrib(node, "action")) node.attribs.action = encodeUrl(node.attribs.action, origin);
    if (hasAttrib(node, "formaction")) node.attribs.formaction = encodeUrl(node.attribs.formaction, origin);
    if (hasAttrib(node, "form")) node.attribs.action = encodeUrl(node.attribs.action, origin);

    /* other */
    if (hasAttrib(node, "srcdoc")) node.attribs.srcdoc = rewriteHtml(node.attribs.srcdoc, origin);
    if (hasAttrib(node, "srcset")) node.attribs.srcset = rewriteSrcset(node.attribs.srcset, origin);
    if (hasAttrib(node, "imagesrcset")) node.attribs.imagesrcset = rewriteSrcset(node.attribs.imagesrcset, origin);
    if (hasAttrib(node, "style")) node.attribs.style = rewriteCss(node.attribs.style, origin);
    //importmaps!!!
    if (node.type === "script" && node.attribs.type === "importmap" && node.children.length > 0) {
        const scriptContent = node.children[0].data.trim();

        let imports;
        try {
            imports = JSON.parse(scriptContent).imports || {};
        } catch (error) {
            console.error("Error parsing import map:", error);
            imports = {};
        }

        for (const key in imports) {
            if (Object.prototype.hasOwnProperty.call(imports, key)) {
                imports[key] = encodeUrl(imports[key], origin);
            }
        }

        const formattedScriptContent = JSON.stringify({ imports }, null, 2); // retain formatting 

        node.children[0].data = formattedScriptContent;

        node.attribs.type = "importmap";
    }

    if (node.name === "style" && node.children[0] !== undefined) node.children[0].data = rewriteCss(node.children[0].data, origin);
    //leaving this alone for now
    if (node.name === "script" && /(application|text)\/javascript|importmap|undefined/.test(node.attribs.type) && node.children[0] !== undefined) node.children[0].data = rewriteJs(node.children[0].data, origin);
    if (node.name === "meta" && hasAttrib(node, "http-equiv")) {
        if (node.attribs["http-equiv"] === "content-security-policy") {
            node = {};
        } else if (node.attribs["http-equiv"] === "refresh" && node.attribs.content.includes("url")) {
            const contentArray = node.attribs.content.split("url=");
            contentArray[1] = encodeUrl(contentArray[1].trim(), origin);
            node.attribs.content = contentArray.join("url=");
        }
    }

    if (node.name === "head") {
        const scramjetScripts = [];
        ["codecs", "config", "bundle", "client"].forEach((script) => {
            scramjetScripts.push(new Element("script", {
                src: self.__scramjet$config[script]
            }));
        });

        node.children.unshift(...scramjetScripts);
    }

    if (node.childNodes) {
        for (const childNode in node.childNodes) {
            node.childNodes[childNode] = traverseParsedHtml(node.childNodes[childNode], origin);
        }
    }

    return node;
}


function parseImportValues(scriptContent: string): string[] {
    // Implement your logic to parse import values from script content
    // This could involve regex, JSON parsing, or any custom logic based on your script format
    // Example: Extract values from a JSON-like structure
    const importMap = JSON.parse(scriptContent);
    return Object.values(importMap.imports || {});
}

// stole from osana lmao
export function rewriteSrcset(srcset: string, origin?: URL) {
    const urls = srcset.split(/ [0-9]+x,? ?/g);
    if (!urls) return "";
    const sufixes = srcset.match(/ [0-9]+x,? ?/g);
    if (!sufixes) return "";
    const rewrittenUrls = urls.map((url, i) => {
        if (url && sufixes[i]) {
            return encodeUrl(url, origin) + sufixes[i];
        }
    });

    return rewrittenUrls.join("");
}
