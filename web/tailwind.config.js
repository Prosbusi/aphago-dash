/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ["Manrope", "system-ui", "sans-serif"] },
      colors: {
        ground: "#F6F4EF",
        ink: "#17171A",
        body: "#3B3934",
        muted: "#5E5B55",
        line: "#E4E0D8",
        soft: "#EEEBE4",
        roxo: { DEFAULT: "#A065E7", claro: "#D9C3F5", texto: "#7A3DC8", escuro: "#5B2A9A" },
        laranja: "#E39A6F",
        bom: "#1F7A4D",
        ruim: "#B42318",
      },
    },
  },
  plugins: [],
};
