import React from "react";
import WrapperPage from "../WrapperPage";

const tos = [
  {
    title: "1. Terms",
    content: "By accessing this Website, you are agreeing to be bound by these Website Terms and Conditions of Use and agree that you are responsible for the agreement with any applicable local laws. If you disagree with any of these terms, you are prohibited from accessing this site. The materials contained in this Website are protected by copyright and trade mark law.",
  },
  {
    title: "2. Use License",
    content: "Permission is granted to temporarily download one copy of the materials on this Website for personal, non-commercial transitory viewing only. This is the grant of a license, not a transfer of title.",
  },
  {
    title: "3. Disclaimer",
    content: 'All the materials on singpro.app\'s Website are provided "as is". singpro.app makes no warranties, may it be expressed or implied, therefore negates all other warranties. Furthermore, singpro.app does not make any representations concerning the accuracy or reliability of the use of the materials on its Website or otherwise relating to such materials or any sites linked to this Website.',
  },
  {
    title: "4. Limitations",
    content: "singpro.app or its suppliers will not be hold accountable for any damages that will arise with the use or inability to use the materials on singpro.app's Website, even if singpro.app or an authorize representative of this Website has been notified, orally or written, of the possibility of such damage. Some jurisdiction does not allow limitations on implied warranties or limitations of liability for incidental damages, these limitations may not apply to you.",
  },
  {
    title: "5. Revisions and Errata",
    content: "The materials appearing on singpro.app's Website may include technical, typographical, or photographic errors. singpro.app will not promise that any of the materials in this Website are accurate, complete, or current. singpro.app may change the materials contained on its Website at any time without notice. singpro.app does not make any commitment to update the materials.",
  },
  {
    title: "6. Links",
    content: "singpro.app has not reviewed all of the sites linked to its Website and is not responsible for the contents of any such linked site. The presence of any link does not imply endorsement by singpro.app of the site. The use of any linked website is at the user's own risk.",
  },
  {
    title: "7. Site Terms of Use Modifications",
    content: "singpro.app may revise these Terms of Use for its Website at any time without prior notice. By using this Website, you are agreeing to be bound by the current version of these Terms and Conditions of Use.",
  },
  {
    title: "8. YouTube Terms of Service",
    content: null,
    html: (
      <>
        singpro.app uses the YouTube Data API and embedded YouTube videos. By using singpro.app you are
        confirming to comply with YouTube's Terms of Service, which can be accessed at{" "}
        <a
          href="https://www.youtube.com/t/terms"
          target="_blank"
          rel="noopener noreferrer"
          className="text-neon-cyan hover:text-neon-magenta underline"
        >
          https://www.youtube.com/t/terms
        </a>.
      </>
    ),
  },
];

const TermsOfServicePage = () =>
  <WrapperPage>
    <div className="text-gray-300 space-y-6">
      {tos.map((section, i) => (
        <div key={i}>
          <h3 className="text-white font-bold mb-2">{section.title}</h3>
          {section.content && <p>{section.content}</p>}
          {section.html && <p>{section.html}</p>}
        </div>
      ))}
    </div>
  </WrapperPage>;

export default TermsOfServicePage;
