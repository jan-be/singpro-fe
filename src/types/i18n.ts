/**
 * The `t` that logic modules take from a page (useTranslation): i18next's TFunction fits it, and so does a test's
 * stand-in such as `(key) => key`.
 */
export type Translate = (key: string, options?: Record<string, unknown>) => string;
