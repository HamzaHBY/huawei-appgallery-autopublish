import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,js,jsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#c8102e",
          dark: "#9d0c24",
        },
      },
    },
  },
  plugins: [],
};

export default config;
