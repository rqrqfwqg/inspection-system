// 显式声明 PostCSS 配置，切断对父目录（inspection-system/postcss.config.js + tailwind.config.js）的隐式继承。
// 本项目不使用 Tailwind：若不声明，postcss-load-config 会向上查找并套用旧工程的 Tailwind 插件，
// 导致构建输出受另一个工程配置影响（日志里会出现 "content option is missing" 警告）。
// 零插件即可满足本项目需要（样式为手写 CSS + Element Plus 产物，目标浏览器为现代 Chrome/Edge/Firefox）。
export default {
  plugins: {},
}
