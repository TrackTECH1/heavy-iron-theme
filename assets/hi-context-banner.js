(function () {
  function pretty(value) {
    return String(value || "")
      .replace(/[+_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, function (letter) {
        return letter.toUpperCase();
      });
  }

  function text(node, message, modifier) {
    node.classList.toggle("hi-context-banner--winter", modifier === "winter");
    node.innerHTML = message;
    node.hidden = false;
  }

  var node = document.querySelector("[data-hi-context-banner]");
  if (!node) return;

  var params = new URLSearchParams(window.location.search);
  var machine = pretty(params.get("machine") || params.get("target_machine"));
  var region = pretty(params.get("region") || params.get("state") || params.get("market"));
  var application = pretty(params.get("application") || params.get("vocation"));
  var trackSize = node.getAttribute("data-track-size") || "this track size";
  var tread = node.getAttribute("data-tread-pattern") || "";

  if (machine) {
    text(
      node,
      "<strong>VERIFIED FIT CONTEXT</strong>This " +
        trackSize +
        " track is being checked against your " +
        machine +
        ". Confirm the stamped size on the old track before checkout when serial-range changes are possible."
    );
    return;
  }

  if (application) {
    text(
      node,
      "<strong>JOB-SITE TREAD CONTEXT</strong>You came in through " +
        application +
        ". " +
        (tread ? tread + " is the selected tread pattern for this product." : "Choose the tread option that matches your terrain before checkout.")
    );
    return;
  }

  if (region) {
    text(
      node,
      "<strong>REGIONAL BUYING CONTEXT</strong>Shipping and tread choice are being evaluated for " +
        region +
        ". For winter or high-precipitation work, compare snow and mud tread options before checkout.",
      "winter"
    );
  }
})();
