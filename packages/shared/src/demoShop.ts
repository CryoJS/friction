/**
 * "Northpeak": a tiny shop with real friction built in. It is the golden run's
 * story made clickable, and a demo target you fully control:
 *
 *   dead_click       "Add to cart" silently does nothing until a size is chosen
 *   retry            ...so people click it again
 *   error_text       size M of the Alpine parka is out of stock, revealed only on submit
 *   long_wait        the Alpine parka page takes 5.6s to respond
 *   modal_interrupt  a newsletter popup opens on a timer on product pages
 *   keyboard_trap    the popup takes no focus and swallows Tab; only Escape closes it
 *   ambiguous_label  every search result's button is named "Select options"
 *   loop             stock is invisible from the listing, so shoppers pogo-stick
 *
 * Pure (path in, HTML out) so it can be served from anywhere: the Worker
 * serves it at /demo-shop (public, reachable by Browserbase), and
 * apps/orchestrator/scripts/smoke-local.ts serves it on localhost.
 */

export interface DemoShopResponse {
  status: number;
  html: string;
  /** Simulated server latency. */
  delayMs: number;
}

interface Product {
  slug: string;
  name: string;
  price: string;
  /** Sizes that are sold out in the default colour. */
  soldOut: string[];
  slow?: boolean;
}

const PRODUCTS: Product[] = [
  { slug: "alpine-down-parka", name: "Alpine Down Parka", price: "$349", soldOut: ["M"], slow: true },
  { slug: "summit-insulated-jacket", name: "Summit Insulated Jacket", price: "$279", soldOut: ["M"] },
  { slug: "glacier-3-in-1-jacket", name: "Glacier 3-in-1 Jacket", price: "$319", soldOut: [] },
  { slug: "ridgeline-shell", name: "Ridgeline Shell", price: "$229", soldOut: [] },
];
const SIZES = ["XS", "S", "M", "L", "XL"];

const esc = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CSS = `*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#0f172a;background:#fff}
a{color:inherit}header{display:flex;align-items:center;gap:22px;padding:14px 32px;border-bottom:1px solid #e2e8f0}
.logo{font-weight:800;letter-spacing:2px;font-size:20px;text-decoration:none}nav{display:flex;gap:18px}nav a{text-decoration:none;font-weight:500}
form.search{margin-left:auto;display:flex;gap:6px}input[type=search]{padding:8px 12px;border:1px solid #94a3b8;border-radius:6px;width:240px;font:inherit}
button,.btn{font:inherit;font-weight:600;padding:10px 18px;border-radius:6px;border:1px solid #94a3b8;background:#fff;cursor:pointer;text-decoration:none;display:inline-block}
.primary{background:#0f172a;color:#fff;border-color:#0f172a}main{padding:28px 32px;max-width:1240px;margin:0 auto}
.hero{background:#cbd5e1;border-radius:10px;padding:90px 64px}.hero h1{font-size:50px;margin:0 0 8px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}.card .img,.pimg{background:#e2e8f0;border-radius:8px}.card .img{height:240px}
.card h3{margin:10px 0 0;font-size:15px}.card p{margin:0 0 8px;color:#64748b}.card button{width:100%}
.product{display:grid;grid-template-columns:1fr 1fr;gap:48px}.pimg{height:520px}fieldset{border:0;padding:0;margin:18px 0}legend{color:#64748b;font-size:13px;margin-bottom:6px}
.opts{display:flex;gap:8px}.opts label{border:1px solid #94a3b8;border-radius:6px;padding:9px 16px;cursor:pointer}.opts input{margin-right:6px}
#add{width:100%;padding:16px}.err{margin-top:12px;padding:10px 12px;border:1px solid #fca5a5;background:#fef2f2;color:#b91c1c;border-radius:6px;font-weight:600}.err:empty{display:none}
.crumbs{color:#64748b;font-size:13px;margin-bottom:14px}.look{height:520px;background:#e2e8f0;border-radius:8px;margin:18px 0}
#cookies{position:fixed;left:0;right:0;bottom:0;z-index:20;background:#fff;border-top:1px solid #e2e8f0;padding:18px 32px;display:flex;align-items:center;gap:12px}#cookies p{margin:0;flex:1}
.veil{position:fixed;inset:0;z-index:50;background:rgba(15,23,42,.5);display:flex;align-items:center;justify-content:center}
.pop{background:#fff;border-radius:12px;padding:36px;width:480px;text-align:center}.pop h2{margin:0 0 6px}.pop input{width:100%;padding:12px;margin:14px 0;border:1px solid #94a3b8;border-radius:6px;font:inherit}
.pop .primary{width:100%}.link{background:none;border:0;text-decoration:underline;font-weight:400;margin-top:12px}
.drawer{position:fixed;top:0;right:0;bottom:0;z-index:40;width:420px;background:#fff;box-shadow:-8px 0 30px rgba(15,23,42,.2);padding:28px}[hidden]{display:none!important}`;

function layout(base: string, title: string, body: string, script = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} | Northpeak</title><style>${CSS}</style></head><body>
<header><a class="logo" href="${base}/" aria-label="Northpeak home">NORTHPEAK</a>
<nav aria-label="Main"><a href="${base}/collections/mens-jackets">Men</a><a href="${base}/collections/mens-jackets">Women</a><a href="${base}/collections/winter-edit">Winter Edit</a><a href="${base}/collections/mens-jackets">Sale</a></nav>
<form class="search" action="${base}/search" role="search"><label for="q" hidden>Search products</label><input id="q" name="q" type="search" placeholder="Search products" aria-label="Search products"><button type="submit">Search</button></form></header>
<main>${body}</main>
<div id="cookies" hidden><p>We use cookies to personalise content and analyse traffic.</p><button id="ck-manage">Manage preferences</button><button id="ck-ok" class="primary">Accept all cookies</button></div>
<script>(function(){var c=document.getElementById("cookies");if(!sessionStorage.getItem("ck")){c.hidden=false}
function done(){sessionStorage.setItem("ck","1");c.hidden=true}document.getElementById("ck-ok").onclick=done;document.getElementById("ck-manage").onclick=done})();${script}</script></body></html>`;
}

function card(base: string, product: Product, buttonLabel: string): string {
  const href = `${base}/products/${product.slug}`;
  return `<article class="card"><div class="img"></div><h3><a href="${href}">${esc(product.name)}</a></h3><p>${product.price}</p><button onclick="location.href='${href}'">${buttonLabel}</button></article>`;
}

function productPage(base: string, product: Product): string {
  const sizes = SIZES.map((size) => `<label><input type="radio" name="size" value="${size}">${size}</label>`).join("");
  const body = `<div class="crumbs"><a href="${base}/">Home</a> / <a href="${base}/collections/mens-jackets">Jackets &amp; Coats</a> / ${esc(product.name)}</div>
<div class="product"><div class="pimg"></div><div><h1>${esc(product.name)}</h1><p style="font-size:20px">${product.price}.00</p>
<fieldset><legend>Colour</legend><div class="opts"><label><input type="radio" name="colour" value="Black" checked>Black</label><label><input type="radio" name="colour" value="Forest Green">Forest Green</label></div></fieldset>
<fieldset><legend>Size</legend><div class="opts">${sizes}</div></fieldset>
<button id="add" class="primary">Add to cart</button><div id="err" class="err" role="alert"></div>
<p style="color:#64748b;margin-top:22px">Free shipping over $150. 30-day returns.</p></div></div>
<div id="drawer" class="drawer" role="dialog" aria-label="Added to cart" hidden><h2>Added to cart</h2><p>${esc(product.name)}</p><a id="view" class="btn primary" href="${base}/cart">View cart</a></div>
<div id="veil" class="veil" hidden><div class="pop"><h2>Get 10% off your first order</h2><p>Join the Northpeak list for early access and offers.</p><input type="email" placeholder="Email address" aria-label="Email address"><button class="primary">Sign me up</button><br><button id="nope" class="link">No thanks</button></div></div>`;

  // The bugs are deliberate. Each one is a finding Friction should make.
  const script = `(function(){var soldOut=${JSON.stringify(product.soldOut)};var err=document.getElementById("err");
document.getElementById("add").onclick=function(){var s=document.querySelector("input[name=size]:checked");var c=document.querySelector("input[name=colour]:checked").value;
if(!s){return}/* dead click: no size, no feedback at all */
if(c==="Black"&&soldOut.indexOf(s.value)>=0){err.textContent="Sorry, size "+s.value+" is out of stock in Black. Please choose another size or colour.";return}
err.textContent="";sessionStorage.setItem("cart","1");document.getElementById("drawer").hidden=false;document.getElementById("view").focus()};
var veil=document.getElementById("veil");function close(){veil.hidden=true}
if(!sessionStorage.getItem("nl")){setTimeout(function(){sessionStorage.setItem("nl","1");veil.hidden=false},2500)}/* opens on a timer, takes no focus */
document.getElementById("nope").onclick=close;
document.addEventListener("keydown",function(e){if(veil.hidden)return;if(e.key==="Escape"){close();document.body.focus()}else if(e.key==="Tab"){e.preventDefault()}/* keyboard trap */},true)})();`;
  return layout(base, product.name, body, script);
}

export function demoShopResponse(pathname: string, search: string, base = ""): DemoShopResponse {
  const path = (pathname.startsWith(base) ? pathname.slice(base.length) : pathname).replace(/\/+$/, "") || "/";
  const page = (title: string, body: string, delayMs = 0, script = ""): DemoShopResponse => ({ status: 200, html: layout(base, title, body, script), delayMs });

  if (path === "/") {
    return page(
      "Built for the cold",
      `<section class="hero"><h1>Built for the cold.</h1><p style="font-size:18px">The Winter Edit has landed: parkas, shells and layers.</p><a class="btn primary" href="${base}/collections/winter-edit">Shop the Winter Edit</a></section>
<h2>Shop by category</h2><div class="grid">${["Men", "Women", "Kids", "Sale"].map((c) => `<a class="card" href="${base}/collections/mens-jackets" style="text-decoration:none"><div class="img"></div><h3>${c}</h3></a>`).join("")}</div>`,
    );
  }
  if (path === "/collections/winter-edit") {
    return page("The Winter Edit", `<h1>The Winter Edit</h1><p>A field journal from the north ridge. Photography by our team.</p>${'<div class="look"></div>'.repeat(4)}<p>More stories soon.</p>`);
  }
  if (path === "/collections/mens-jackets") {
    return page("Men's Jackets & Coats", `<div class="crumbs"><a href="${base}/">Home</a> / Jackets &amp; Coats</div><h1>Men's Jackets &amp; Coats</h1><div class="grid">${PRODUCTS.map((p) => card(base, p, `Quick view: ${esc(p.name)}`)).join("")}</div>`);
  }
  if (path === "/search") {
    const query = new URLSearchParams(search).get("q") ?? "";
    // Every button gets the same accessible name: ambiguous for keyboard and screen-reader users.
    return page(`Results for ${query}`, `<h1>Results for &ldquo;${esc(query)}&rdquo;</h1><div class="grid">${PRODUCTS.map((p) => card(base, p, "Select options")).join("")}</div>`);
  }
  if (path === "/cart") {
    return page("Your cart", `<h1>Your cart (<span id="n">0</span>)</h1><p id="line">Your cart is empty.</p><a class="btn" href="${base}/">Continue shopping</a>`, 0, `if(sessionStorage.getItem("cart")){document.getElementById("n").textContent="1";document.getElementById("line").textContent="1 jacket. Subtotal $349."}`);
  }
  const product = PRODUCTS.find((p) => path === `/products/${p.slug}`);
  if (product) return { status: 200, html: productPage(base, product), delayMs: product.slow ? 5600 : 0 };

  return { status: 404, html: layout(base, "Not found", `<h1>Page not found</h1><p><a href="${base}/">Back to the shop</a></p>`), delayMs: 0 };
}
