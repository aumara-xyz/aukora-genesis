window.__ModuleLoader__.load({
  id: "auma-theme",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    // Browser half: fetch the declarative theme from the host half and map the accent onto the
    // harness's existing --dsw-* design tokens. Removing this entry removes the style element.
    function apply(ctx) {
      var style = document.createElement("style");
      style.setAttribute("data-auma-theme", "");
      var alive = true;
      fetch("auma-theme/theme.json", { credentials: "same-origin", cache: "no-store" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (t) {
          if (!alive || !t || typeof t.accent !== "string" || !/^#[0-9a-fA-F]{6}$/.test(t.accent)) return;
          var c = t.accent;
          style.textContent = "body, body[data-ds-dark-theme] {" +
            "--dsw-alias-brand-primary:" + c + " !important;" +
            "--dsw-alias-button-primary-fill:" + c + " !important;" +
            "--dsw-alias-button-primary-hover:" + c + " !important;" +
            "--dsw-alias-state-business-primary:" + c + " !important;" +
            "--dsw-alias-brand-primary-new-colorprimary-new-color:" + c + " !important;" +
            "--dsw-specific-sidebar-nav-item-active-accent:" + c + " !important;}";
          document.head.appendChild(style);
          document.documentElement.setAttribute("data-auma-accent", c);
        })
        .catch(function () {});
      ctx.effect(function () {
        return function () { alive = false; style.remove(); document.documentElement.removeAttribute("data-auma-accent"); };
      });
    }
    exports.apply = apply;
    return module.exports;
  }
});
