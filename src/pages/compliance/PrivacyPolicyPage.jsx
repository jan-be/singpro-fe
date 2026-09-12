import React from "react";
import WrapperPage from "../WrapperPage";

const PrivacyPolicyPage = () => (
  <WrapperPage>
    <div className="text-gray-300 space-y-6">
      <h1 className="text-2xl font-bold text-white">Privacy Policy</h1>
      <p className="text-sm text-gray-500">Last updated: 12 September 2026</p>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-white">1. Controller</h2>
        <p>
          singpro.app is operated by Jan Beckschewe (see{" "}
          <a href="/contact" className="text-neon-cyan hover:text-neon-magenta underline">Contact</a>
          ). References to "we", "us", or "our" refer to the operator of this website.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-white">2. What data we collect</h2>
        <p>singpro.app is designed to collect as little personal data as possible. Account registration is <strong className="text-white">optional</strong> – you can sing without one – and we do not use analytics or tracking scripts.</p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li><strong className="text-white">Accounts (optional):</strong> If you create an account we store your e-mail address (verified with a one-time code and used only to sign you in – no newsletters), the display name you choose, the public key of each passkey you register and/or a salted hash of an optional password (never the password itself), the dates you created and last used the account, and your sign-in sessions. Sign-in codes are delivered by our e-mail provider Resend (Resend, Inc., USA), which processes your address and the message for that purpose only. Other signed-in users can find you by your exact e-mail address, which shows them your display name but never the address. You can delete your account at any time from your profile page, which removes everything listed here together with your saved scores and friendships.</li>
          <li><strong className="text-white">Saved scores and friends:</strong> While signed in, every song you finish is saved with its score, stars, date and party code, and shown on your profile and to your friends. We also remember which signed-in users finished a song in the same party, to suggest them as friends to each other. Friend requests you send or accept are stored until either side removes the friendship. Profiles (display name, statistics, best songs) are visible to anyone who knows the display name.</li>
          <li><strong className="text-white">Party sessions:</strong> When you create or join a party, we temporarily store your chosen display name, party code, and song queue in server memory. This data is not persisted after the party ends.</li>
          <li><strong className="text-white">Listen history:</strong> We record which songs are played (artist, title, video ID, party code) to power the "Popular at Parties" feature. This data does not contain personal identifiers.</li>
          <li><strong className="text-white">Microphone audio and pitch telemetry:</strong> When you sing, real-time pitch detection runs in your browser. Audio recorded during active singing sessions (compressed Opus audio), along with pitch detection telemetry and timing metadata, is uploaded to our server to evaluate, benchmark, and improve the accuracy of pitch detection and scoring algorithms. This audio is associated only with song and session metadata, never with personal accounts.</li>
          <li><strong className="text-white">Language preference:</strong> Stored in your browser's localStorage. Not sent to any server.</li>
          <li><strong className="text-white">Server logs:</strong> Our web server may log IP addresses and request metadata for operational purposes. These logs are rotated automatically and not used for tracking.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-white">3. Third-party services</h2>
        <p>singpro.app embeds content from the following third-party services, which may collect data independently:</p>
        <ul className="list-disc list-inside space-y-2 ml-2">
          <li>
            <strong className="text-white">YouTube (Google):</strong> Song videos are embedded with the YouTube IFrame Player API in YouTube's{" "}
            <strong className="text-white">privacy-enhanced mode</strong> (served from youtube-nocookie.com), which does{" "}
            <strong className="text-white">not set cookies</strong> on your device and does not use your viewing to personalise your YouTube experience. Song thumbnails are loaded from YouTube's image servers (i.ytimg.com), which also set no cookies. Loading the player or a thumbnail still transfers technical request data such as your IP address to Google, which processes it according to{" "}
            <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-neon-cyan hover:text-neon-magenta underline">
              Google's Privacy Policy
            </a>. By using singpro.app, you also agree to the{" "}
            <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer" className="text-neon-cyan hover:text-neon-magenta underline">
              YouTube Terms of Service
            </a>.
          </li>
          <li>
            <strong className="text-white">SponsorBlock:</strong> We query the SponsorBlock API to skip non-music segments. This sends the video ID to their servers. See{" "}
            <a href="https://sponsor.ajay.app/about" target="_blank" rel="noopener noreferrer" className="text-neon-cyan hover:text-neon-magenta underline">
              SponsorBlock's privacy info
            </a>.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-white">4. Cookies</h2>
        <p>singpro.app sets a single, strictly necessary cookie (<code className="text-neon-cyan">singpro_session</code>) only after you sign in to an account; it keeps you signed in for up to 180 days and is removed when you sign out. No other cookies are set, and the embedded YouTube player runs in privacy-enhanced mode so that it does not set cookies either. Preferences such as your language, volume settings and which one-time hints you have already seen are kept in your browser's localStorage (not cookies) and are never sent to a server. Your current party session is kept in sessionStorage and discarded when the tab is closed.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-white">5. Your rights (GDPR)</h2>
        <p>If you are located in the European Economic Area, you have the right to:</p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>Request access to any personal data we hold about you</li>
          <li>Request correction or deletion of your data</li>
          <li>Object to or restrict processing of your data</li>
          <li>Lodge a complaint with your local data protection authority</li>
        </ul>
        <p>Without an account we hold no data that identifies you, so most of these rights are satisfied by default. With an account, your profile page shows everything we store about you, and deleting the account there erases it. If you have any concerns, please contact us.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-white">6. Data retention</h2>
        <p>Party session data is held in server memory only and discarded when the party ends or the server restarts. Listen history records and anonymous microphone audio recordings for pitch calibration are retained to power song popularity and model evaluation benchmarks. Server logs are rotated within 14 days.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-white">7. Contact</h2>
        <p>
          For privacy-related inquiries, see our{" "}
          <a href="/contact" className="text-neon-cyan hover:text-neon-magenta underline">Contact page</a>.
        </p>
      </section>
    </div>
  </WrapperPage>
);

export default PrivacyPolicyPage;
