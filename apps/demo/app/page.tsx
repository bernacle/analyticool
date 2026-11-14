// Studio CSS is page-scoped; the root layout loads none (see /embed-themes).
import "./globals.css";
import { Studio } from "./studio/studio";

export default function Home() {
  return <Studio />;
}
