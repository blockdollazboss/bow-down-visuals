/* ─── The Palace Boards (NATIVE-PLAN §3.1) ──────────────────────────
   The Board pattern's three surfaces, one per station: the Charts
   (Music Hall), the Earnings Board (Get Paid Room), the Studio
   Board (My Studio). The panel host dispatches on
   pattern === "board" + station id to exactly these. */
export { ChartsBoard, type ChartsBoardProps } from "./ChartsBoard";
export { EarningsBoard } from "./EarningsBoard";
export { StudioBoard, type StudioBoardProps } from "./StudioBoard";
