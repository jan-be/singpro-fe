import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { layoutCard, renderShareImage } from "../logic/shareImage";
import ShareCardImage from "./ShareCardImage";

/**
 * Draws a share card (ShareCardImage, logic/shareImage.js) into a JPEG. The
 * card is put in the page, off-screen and in the body (away from any
 * scrolling or blur), only for the moment it takes to draw it, so the caller
 * renders `element` somewhere and calls draw(cardProps, { art, hue }), which
 * resolves to the image Blob. cardProps are ShareCardImage's, with
 * art: { aspect } (the picture itself goes in the second argument).
 */
export function useShareCardDrawer() {
  const [props, setProps] = useState(null);
  const cardRef = useRef(null);
  const ready = useRef(null); // resolves with the card once it is in the page

  useLayoutEffect(() => {
    if (props && cardRef.current && ready.current) {
      ready.current(cardRef.current);
      ready.current = null;
    }
  }, [props]);

  const draw = useCallback(async (cardProps, { art, hue }) => {
    const card = await new Promise(resolve => {
      ready.current = resolve;
      setProps(cardProps);
    });
    try {
      layoutCard(card);
      return await renderShareImage(card, { art, hue });
    } finally {
      setProps(null);
    }
  }, []);

  const element = props && createPortal(<ShareCardImage ref={cardRef} {...props} />, document.body);
  return { draw, element };
}
