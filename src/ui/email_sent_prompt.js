let activeEmailPrompt = null;

export function showEmailSentPrompt(kind = "verification", container = document.body) {
  if (activeEmailPrompt) return activeEmailPrompt;

  activeEmailPrompt = new Promise((resolve) => {
    const isReset = kind === "reset";
    const dialog = document.createElement("dialog");
    dialog.className = "requiredPhotoDialog emailSentDialog";
    dialog.setAttribute("aria-labelledby", "emailSentTitle");
    dialog.innerHTML = `
      <div class="requiredPhotoSheet">
        <div class="emailSentIcon" aria-hidden="true">✉</div>
        <div class="stepEyebrow">Email sent</div>
        <div class="h1" id="emailSentTitle">Check your inbox</div>
        <p>We sent a six-digit ${isReset ? "password reset" : "email verification"} code.</p>
        <p class="emailSentDialog__spam"><strong>Can’t find it?</strong> Check your Spam or Junk folder too.</p>
        <button class="btn primary requiredPhotoChoose" type="button" data-email-prompt-close>OK, I’ll check</button>
      </div>`;

    const finish = () => {
      if (dialog.open) dialog.close();
      dialog.remove();
      activeEmailPrompt = null;
      resolve();
    };
    dialog.querySelector("[data-email-prompt-close]")?.addEventListener("click", finish);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish();
    });

    container.appendChild(dialog);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else finish();
  });

  return activeEmailPrompt;
}
