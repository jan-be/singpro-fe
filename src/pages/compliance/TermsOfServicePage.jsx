import React from "react";
import WrapperPage from "../WrapperPage";

const TermsOfServicePage = () => (
  <WrapperPage>
    <div className="text-gray-300 space-y-6">
      <h1 className="text-2xl font-bold text-white">Terms of Service</h1>
      <p className="text-sm text-gray-500">Last updated: 18 April 2026</p>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-white">1. Acceptance of Terms</h2>
        <p>By accessing or using singpro.app, you agree to be bound by these Terms of Service. If you do not agree, you may not use the service.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-white">2. Description of Service</h2>
        <p>singpro.app is a free, browser-based karaoke platform that lets users sing along to songs with real-time pitch scoring. The service is provided as-is for personal, non-commercial use.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-white">3. User Conduct</h2>
        <p>You agree not to:</p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>Use the service for any unlawful purpose</li>
          <li>Attempt to interfere with or disrupt the service</li>
          <li>Impersonate other users or misrepresent your identity</li>
          <li>Use automated tools to scrape or overload the service</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-white">4. Intellectual Property</h2>
        <p>Song lyrics and musical compositions displayed on singpro.app are the property of their respective rights holders. singpro.app does not claim ownership of any third-party content. The singpro.app software and design are the property of the operator.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-white">5. Third-Party Services</h2>
        <p>
          singpro.app uses embedded YouTube videos. By using singpro.app, you also agree to the{" "}
          <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer" className="text-neon-cyan hover:text-neon-magenta underline">
            YouTube Terms of Service
          </a>{" "}
          and{" "}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-neon-cyan hover:text-neon-magenta underline">
            Google Privacy Policy
          </a>.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-white">6. Disclaimer of Warranties</h2>
        <p>The service is provided "as is" and "as available" without warranties of any kind, either express or implied. We do not guarantee that the service will be uninterrupted, error-free, or free of harmful components.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-white">7. Limitation of Liability</h2>
        <p>To the fullest extent permitted by law, the operator shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of or inability to use the service.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-white">8. Modifications</h2>
        <p>We reserve the right to modify these terms at any time. Changes take effect when posted on this page. Continued use of the service after changes constitutes acceptance of the revised terms.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-white">9. Governing Law</h2>
        <p>These terms are governed by the laws of the Federal Republic of Germany. Any disputes shall be subject to the jurisdiction of the courts in Germany.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-white">10. Contact</h2>
        <p>
          Questions about these terms? See our{" "}
          <a href="/contact" className="text-neon-cyan hover:text-neon-magenta underline">Contact page</a>.
        </p>
      </section>
    </div>
  </WrapperPage>
);

export default TermsOfServicePage;
