/* assets/js/links.js — outbound clicks as Vercel Web Analytics events.
 *
 * api/go.mjs is the authoritative count: it runs on the server and works with
 * JavaScript switched off. This file adds the same click to the Analytics
 * dashboard so the numbers can be read without trawling logs.
 *
 * It never calls preventDefault and never rewrites an href. If the file fails
 * to load, or `va` is not there because Web Analytics is off, every link on the
 * page still goes exactly where it went before.
 */

(function () {
  "use strict";

  var PREFIX = "/go/";

  document.addEventListener("click", function (event) {
    var target = event.target;
    if (!target || typeof target.closest !== "function") return;

    var link = target.closest('a[href^="' + PREFIX + '"]');
    if (!link) return;

    var slug = link.getAttribute("href").slice(PREFIX.length);
    if (typeof window.va !== "function") return;

    // The raw queue call, not the npm package's track(): this repo has no
    // build step, so there is nothing to import the wrapper from.
    window.va("event", { name: "outbound", data: { slug: slug } });
  });
})();
