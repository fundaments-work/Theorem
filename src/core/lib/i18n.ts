import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import en from "./i18n-resources/en.json";
import es from "./i18n-resources/es.json";
import fr from "./i18n-resources/fr.json";

const resources = { en, es, fr };

export { en, es, fr };

export async function initI18n(): Promise<void> {
    await i18next
        .use(LanguageDetector)
        .use(initReactI18next)
        .init({
            resources,
            fallbackLng: "en",
            defaultNS: "translation",
            interpolation: {
                escapeValue: false,
            },
            detection: {
                order: ["navigator", "htmlTag"],
                caches: [],
            },
        });
}

export const i18n = i18next;
