(function() {
  function getFluxFs() {
    return document.getElementById("fluxFullscreen");
  }
  function getRelayView() {
    return document.getElementById("fluxFsRelayView");
  }
  function applyLayout() {
    const fs = getFluxFs();
    if (!fs || !fs.classList.contains("show")) return;
    const vv = window.visualViewport;
    if (!vv) return;
    fs.style.top = vv.offsetTop + "px";
    fs.style.height = vv.height + "px";
    const msgs = document.getElementById("fluxFsMessages");
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  }
  function resetLayout() {
    const fs = getFluxFs();
    if (!fs) return;
    fs.style.top = "";
    fs.style.height = "";
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", applyLayout);
    window.visualViewport.addEventListener("scroll", applyLayout);
  }
  document.addEventListener("focusin", function(e) {
    if (e.target && e.target.id === "fluxFsInput") {
      setTimeout(applyLayout, 300);
    }
  });
  document.addEventListener("focusout", function(e) {
    if (e.target && e.target.id === "fluxFsInput") {
      setTimeout(resetLayout, 100);
    }
  });
  window._fluxApplyKeyboardLayout = applyLayout;
})();