import React, { useEffect } from 'react';
import { doAudioProcessing } from "../logic/MicrophoneInput";

const SingOnlyPage = props => {

  useEffect(() => {
    let wss;

    const doWss = async () => {
      const apiDomain = `api.${window.location.hostname}`;

      wss = new WebSocket(`wss://${apiDomain}/ws`);
      wss.onopen = () => {
        wss.send(JSON.stringify({ type: "connected" }));
        doAudioProcessing(note => {
          wss.send(JSON.stringify(
            { type: "note", data: { note } }
          ));
        });
      };
      wss.onmessage = msg => wss.send("acked" + msg);
    };

    const handleAudioProcessing = () => {
    };

    doWss();
    handleAudioProcessing();
  }, []);

  return (
    <div>
      recording
    </div>
  );
};

export default SingOnlyPage;
