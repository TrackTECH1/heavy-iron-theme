const MAX_MACHINE_LENGTH = 80;
const PRODUCT_SIZE_PATTERN = /(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?[a-z]?)x(\d+)/i;

function cleanMachine(value) {
  const decoded = decodeURIComponent(String(value || ""));
  const normalized = decoded.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  const safe = normalized.replace(/[^a-zA-Z0-9 .+/&]/g, "");
  return safe.slice(0, MAX_MACHINE_LENGTH).trim();
}

function sizeFromPath(pathname) {
  const match = pathname.match(PRODUCT_SIZE_PATTERN);
  if (!match) return "";
  return `${match[1]}x${match[2]}x${match[3]}`;
}

function isHtmlResponse(response) {
  return (response.headers.get("content-type") || "").toLowerCase().includes("text/html");
}

class TextElement {
  constructor(value) {
    this.value = value;
  }

  element(element) {
    element.setInnerContent(this.value);
  }
}

class AttributeElement {
  constructor(name, value) {
    this.name = name;
    this.value = value;
  }

  element(element) {
    element.setAttribute(this.name, this.value);
  }
}

class HeadAppendElement {
  constructor(html) {
    this.html = html;
  }

  element(element) {
    element.append(this.html, { html: true });
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (!url.pathname.includes("/products/") || !url.searchParams.has("target_machine")) {
      return fetch(request);
    }

    const machine = cleanMachine(url.searchParams.get("target_machine"));
    if (!machine) return fetch(request);

    const response = await fetch(request);
    if (!isHtmlResponse(response)) return response;

    const size = sizeFromPath(url.pathname);
    const sizeText = size ? ` (${size})` : "";
    const title = `${machine} Rubber Tracks${sizeText} | Heavy Iron Supply`;
    const h1 = `${machine} Replacement Rubber Tracks${sizeText}`;
    const description = `Heavy-duty replacement rubber tracks for ${machine}. In stock with free Lower 48 LTL freight and 1-3 business day delivery.`;

    const headers = new Headers(response.headers);
    headers.set("x-heavy-iron-edge-morph", "target-machine");
    headers.set("x-robots-tag", "noindex, follow");

    const rewritten = new HTMLRewriter()
      .on("title", new TextElement(title))
      .on("h1", new TextElement(h1))
      .on('meta[name="description"]', new AttributeElement("content", description))
      .on('meta[property="og:title"]', new AttributeElement("content", title))
      .on('meta[property="og:description"]', new AttributeElement("content", description))
      .on('meta[name="twitter:title"]', new AttributeElement("content", title))
      .on('meta[name="twitter:description"]', new AttributeElement("content", description))
      .on("head", new HeadAppendElement('<meta name="robots" content="noindex, follow">'))
      .transform(new Response(response.body, { status: response.status, statusText: response.statusText, headers }));

    return rewritten;
  },
};
