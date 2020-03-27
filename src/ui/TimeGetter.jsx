import React, { useEffect, useState } from 'react';

const TimeGetter = props => {
  const [resp, setResp] = useState("");

  useEffect(() => {
    const doFetch = async () => {
      let resp = await fetch("https://api.singprot.janbe.eu/test");
      let data = await resp.text();
      setResp(data);
    };

    const doWss = async () => {
      let wss = new WebSocket("wss://api.singprot.janbe.eu/");
      wss.onopen = () => wss.send("hmm");
      wss.onmessage = msg => wss.send("acked" + msg);
    };

    doFetch();
    doWss();
  });

  return (
    <div>
      {resp}
    </div>
  );
};

export default TimeGetter;
