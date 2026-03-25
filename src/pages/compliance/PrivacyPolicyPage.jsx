import React from "react";
import WrapperPage from "../WrapperPage";

const PrivacyPolicyPage = () =>
  <WrapperPage>
    <div className="text-gray-300 space-y-3">
      <p>Last updated: 19.03.2022</p>
      <p>Singpro itself does not collect any user data.</p>
      <p>
        However, it uses the YouTube Data API and embedded YouTube Videos, which may collect data.
        The embedded YouTube-Player may also serve advertisements and track user activity based on
        Google's Privacy Policy.
      </p>
      <p>
        YouTube is a Google service and its Privacy Policy can be accessed at{" "}
        <a
          href="https://policies.google.com/privacy?hl=en-US"
          target="_blank"
          rel="noopener noreferrer"
          className="text-neon-cyan hover:text-neon-magenta underline"
        >
          https://policies.google.com/privacy?hl=en-US
        </a>.
      </p>
    </div>
  </WrapperPage>;

export default PrivacyPolicyPage;
