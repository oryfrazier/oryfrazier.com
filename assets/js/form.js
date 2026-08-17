/* Submits the contact forms with fetch so the visitor stays on the page.
   With JS disabled the form still POSTs normally to the configured endpoint. */
(function () {
  "use strict";

  var forms = document.querySelectorAll(".js-form");

  Array.prototype.forEach.call(forms, function (form) {
    var status = form.querySelector(".js-form-status");
    var submit = form.querySelector('[type="submit"]');

    // Not configured yet — let the browser do the normal thing.
    if (form.action.indexOf("YOUR_FORM_ID") !== -1) return;

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      status.className = "form__status";
      status.textContent = "Sending…";
      submit.disabled = true;

      fetch(form.action, {
        method: "POST",
        body: new FormData(form),
        headers: { Accept: "application/json" }
      })
        .then(function (response) {
          if (!response.ok) throw new Error("Request failed");
          form.reset();
          status.textContent = "Thank you!";
        })
        .catch(function () {
          status.className = "form__status form__status--error";
          status.textContent =
            "Something went wrong — please email me directly instead.";
        })
        .finally(function () {
          submit.disabled = false;
        });
    });
  });
})();
