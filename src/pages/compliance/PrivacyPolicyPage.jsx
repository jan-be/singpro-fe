import React from "react";
import WrapperPage from "../WrapperPage";

const PrivacyPolicyPage = () =>
  <WrapperPage>
    <div className="text-gray-300 space-y-6">
      <h1 className="text-2xl font-bold text-white">Privacy Policy</h1>
      <p className="text-sm text-gray-500">Last updated: 18 April 2026</p>

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
        <p>singpro.app is designed to collect as little personal data as possible. We do <strong className="text-white">not</strong> require account registration, and we do not use analytics or tracking scripts.</p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li><strong className="text-white">Party sessions:</strong> When you create or join a party, we temporarily store your chosen display name, party code, and song queue in server memory. This data is not persisted after the party ends.</li>
          <li><strong className="text-white">Listen history:</strong> We record which songs are played (artist, title, video ID, party code) to power the "Popular at Parties" feature. This data does not contain personal identifiers.</li>
          <li><strong className="text-white">Microphone audio:</strong> Pitch detection runs entirely in your browser. Raw audio never leaves your device. Only pitch note values are sent to the server for scoring.</li>
          <li><strong className="text-white">Language preference:</strong> Stored in your browser's localStorage. Not sent to any server.</li>
          <li><strong className="text-white">Server logs:</strong> Our web server may log IP addresses and request metadata for operational purposes. These logs are rotated automatically and not used for tracking.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-white">3. Third-party services</h2>
        <p>singpro.app embeds content from the following third-party services, which may collect data independently:</p>
        <ul className="list-disc list-inside space-y-2 ml-2">
          <li>
            <strong className="text-white">YouTube (Google):</strong> We embed YouTube videos using the YouTube IFrame Player API. YouTube may set cookies and collect usage data according to{" "}
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
        <p>singpro.app itself does not set any cookies. However, the embedded YouTube player (operated by Google) may set cookies on your device. These are governed by Google's cookie policies.</p>
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
        <p>Since we collect minimal data and do not maintain user accounts, most of these rights are satisfied by default. If you have any concerns, please contact us.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-white">6. Data retention</h2>
        <p>Party session data is held in server memory only and discarded when the party ends or the server restarts. Listen history records (non-personal) are retained indefinitely. Server logs are rotated within 14 days.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-white">7. Contact</h2>
        <p>
          For privacy-related inquiries, see our{" "}
          <a href="/contact" className="text-neon-cyan hover:text-neon-magenta underline">Contact page</a>.
        </p>
      </section>
    </div>
  </WrapperPage>;

export default PrivacyPolicyPage;
