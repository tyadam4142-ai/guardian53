'use strict';
const form = document.getElementById('request-form');
const input = document.getElementById('domain');
const statusNode = document.getElementById('status');
form.addEventListener('submit', event => {
  event.preventDefault();
  statusNode.textContent = 'Sending request…';
  chrome.runtime.sendMessage({ type: 'G53_REQUEST_ACCESS', domain: input.value }, response => {
    if (chrome.runtime.lastError) { statusNode.textContent = 'Could not contact Guardian 53. Please try again.'; return; }
    if (response?.error) { statusNode.textContent = response.error; return; }
    statusNode.textContent = 'Request sent. Your parent or guardian will review it.';
    form.reset();
  });
});
