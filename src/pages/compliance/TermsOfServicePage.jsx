import React from "react";
import WrapperPage from "../WrapperPage";
import { Typography } from "@mui/material";
import ReactMarkdown from 'react-markdown'

const tos = `
1. Terms

   By accessing this Website, you are agreeing to be bound by these Website Terms and Conditions of Use and agree that you are responsible for the agreement with any applicable local laws. If you disagree with any of these terms, you are prohibited from accessing this site. The materials contained in this Website are protected by copyright and trade mark law.

2. Use License

   Permission is granted to temporarily download one copy of the materials on this Website for personal, non-commercial transitory viewing only. This is the grant of a license, not a transfer of title.

3. Disclaimer

   All the materials on Singpro's Website are provided “as is”. Singpro makes no warranties, may it be expressed or implied, therefore negates all other warranties. Furthermore, Singpro does not make any representations concerning the accuracy or reliability of the use of the materials on its Website or otherwise relating to such materials or any sites linked to this Website.

4. Limitations

   Singpro or its suppliers will not be hold accountable for any damages that will arise with the use or inability to use the materials on Singpro's Website, even if Singpro or an authorize representative of this Website has been notified, orally or written, of the possibility of such damage. Some jurisdiction does not allow limitations on implied warranties or limitations of liability for incidental damages, these limitations may not apply to you.

5. Revisions and Errata

   The materials appearing on Singpro's Website may include technical, typographical, or photographic errors. Singpro will not promise that any of the materials in this Website are accurate, complete, or current. Singpro may change the materials contained on its Website at any time without notice. Singpro does not make any commitment to update the materials.

6. Links

   Singpro has not reviewed all of the sites linked to its Website and is not responsible for the contents of any such linked site. The presence of any link does not imply endorsement by Singpro of the site. The use of any linked website is at the user's own risk.

7. Site Terms of Use Modifications

   Singpro may revise these Terms of Use for its Website at any time without prior notice. By using this Website, you are agreeing to be bound by the current version of these Terms and Conditions of Use.

8. YouTube Terms of Service

   Singpro uses the YouTube Data API and embedded YouTube videos. By using Singpro you are confirming to comply with YouTube's Terms of Service, which can be accessed at [https://www.youtube.com/t/terms](https://www.youtube.com/t/terms).
`

const TermsOfServicePage = () =>
  <WrapperPage>
    <Typography>
      <ReactMarkdown children={tos} />
    </Typography>
  </WrapperPage>;

export default TermsOfServicePage;
