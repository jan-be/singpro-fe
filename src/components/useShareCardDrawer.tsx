import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { layoutCard, renderCountStrip, renderResultLayer, renderShareImage, shareLayout } from "../logic/shareImage";
import ShareCardImage, { type ShareCardImageProps } from "./ShareCardImage";

/** The second argument of draw/drawVideo: the song's art (the picture itself) and the singer's hue */
export type ShareCardPaint = Parameters<typeof renderShareImage>[1];

/**
 * Draws a share card (ShareCardImage, logic/shareImage.js) into a JPEG. The
 * card is put in the page, off-screen and in the body (away from any
 * scrolling or blur), only for the moment it takes to draw it, so the caller
 * renders `element` somewhere and calls draw(cardProps, { art, hue }), which
 * resolves to the image Blob. cardProps are ShareCardImage's, with
 * art: { aspect } (the picture itself goes in the second argument).
 *
 * drawVideo(cardProps, { art, hue }) draws the share video's pictures
 * instead (shareImage.js, "The share video's layers"): resolves to
 * { image, overlay, count, layout } for takes.makeShareVideo, or, where the
 * layers cannot be drawn, to { image } with the whole card, which the server
 * shows still.
 */
export function useShareCardDrawer() {
  const [props, setProps] = useState<ShareCardImageProps | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const ready = useRef<((card: HTMLDivElement) => void) | null>(null); // resolves with the card once it is in the page

  useLayoutEffect(() => {
    if (props && cardRef.current && ready.current) {
      ready.current(cardRef.current);
      ready.current = null;
    }
  }, [props]);

  /** The card with these props, in the page and laid out */
  const mount = useCallback(async (cardProps: ShareCardImageProps) => {
    const card = await new Promise<HTMLDivElement>(resolve => {
      ready.current = resolve;
      setProps(cardProps);
    });
    layoutCard(card);
    return card;
  }, []);

  const draw = useCallback(async (cardProps: ShareCardImageProps, { art, hue }: ShareCardPaint) => {
    try {
      return await renderShareImage(await mount(cardProps), { art, hue });
    } finally {
      setProps(null);
    }
  }, [mount]);

  const drawVideo = useCallback(async (cardProps: ShareCardImageProps, { art, hue }: ShareCardPaint) => {
    try {
      try {
        const image = await renderShareImage(await mount({ ...cardProps, layer: "base" }), { art, hue });
        const card = await mount({ ...cardProps, layer: "result" });
        const overlay = await renderResultLayer(card);
        const count = await renderCountStrip(card);
        const layout = { ...shareLayout(card), hue, ...(count ? { count: count.cell } : {}) };
        return { image, overlay, count: count?.blob ?? null, layout };
      } catch (e) {
        console.warn("The share video's layers could not be drawn; it shows the card still:", e);
        return { image: await renderShareImage(await mount(cardProps), { art, hue }) };
      }
    } finally {
      setProps(null);
    }
  }, [mount]);

  // a layer is a card of its own: layoutCard changes the card behind React's back
  const element = props && createPortal(<ShareCardImage key={props.layer ?? "card"} ref={cardRef} {...props} />, document.body);
  return { draw, drawVideo, element };
}

export type ShareCardDrawer = ReturnType<typeof useShareCardDrawer>;
/** What drawVideo resolves to: the share video's pictures, or the whole card alone */
export type ShareVideoPictures = Awaited<ReturnType<ShareCardDrawer["drawVideo"]>>;
