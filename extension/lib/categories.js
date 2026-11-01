/* Starter catalog only. Adult/gambling/threat categories require a reviewed production feed.
 * Never label a category as active protection until its feed has been provisioned and tested. */
(function (root) {
  'use strict';
  root.G53Categories = Object.freeze({
    adult: { label: 'Adult content (feed not configured)', domains: [] },
    gambling: { label: 'Gambling (feed not configured)', domains: [] },
    social: { label: 'Social media (starter list)', domains: ['tiktok.com', 'instagram.com', 'snapchat.com', 'reddit.com', 'x.com'] },
    gaming: { label: 'Gaming (starter list)', domains: ['roblox.com', 'steampowered.com', 'epicgames.com'] },
    streaming: { label: 'Streaming (starter list)', domains: ['twitch.tv', 'netflix.com', 'disneyplus.com'] },
    phishing: { label: 'Phishing / malware (feed not configured)', domains: [] }
  });
})(globalThis);
