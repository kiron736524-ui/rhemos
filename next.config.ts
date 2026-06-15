import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 关闭 dev 工具浮标：开发时它会遮住左上角品牌区（生产环境本就没有此浮标）
  devIndicators: false,
};

export default nextConfig;
