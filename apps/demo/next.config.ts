import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@analyticool/core", "@analyticool/react"],
  poweredByHeader: false,
};

export default config;
