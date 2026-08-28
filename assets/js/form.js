/* Submits the contact forms with fetch so the visitor stays on the page.
   With JS disabled the form still POSTs normally to the configured endpoint. */
(function () {
  "use strict";

  var forms = document.querySelectorAll(".js-form");

  Array.prototype.forEach.call(forms, function (form) {
    var status = form.querySelector(".js-form-status");
    var submit = form.querySelector('[type="submit"]');

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      status.classList.remove("form__status--error");
      status.textContent = "Sending…";
      submit.disabled = true;

      // Send urlencoded, not multipart: the serverless runtime parses
      // application/x-www-form-urlencoded bodies for us, multipart it does not.
      fetch(form.action, {
        method: "POST",
        body: new URLSearchParams(new FormData(form)),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded"
        }
      })
        .then(function (response) {
          return response.json().catch(function () {
            return {};
          }).then(function (payload) {
            if (!response.ok) throw new Error(payload.error || "Request failed");
            form.reset();
            status.textContent = "Thank you!";
          });
        })
        .catch(function (error) {
          status.classList.add("form__status--error");
          status.textContent =
            error.message && error.message !== "Request failed"
              ? error.message
              : "Something went wrong — please email me directly instead.";
        })
        .finally(function () {
          submit.disabled = false;
        });
    });
  });
})();
