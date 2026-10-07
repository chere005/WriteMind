(* check-wolfram.ts --render: the front end's own view of the two notebooks (port-only: docs/PARITY.md).
   wolframscript -file render-wolfram.wls <folder>. UsingFrontEnd starts a hidden front end (Wolfram Player's, on a Mac
   with the Engine app) and quits it after; the notebooks are opened invisibly, the fallback one has Evaluation ▸
   Evaluate Initialization Cells run on it, and each is saved as a PNG: <folder>/engine-render.png and
   fallback-render.png. What the fallback's cells came to is printed ("IMAGE" where a cell holds a raster). *)
out = $ScriptCommandLine[[2]] <> "/";
UsingFrontEnd[
  nb = NotebookOpen[out <> "engine.nb", Visible -> False];
  Export[out <> "engine-render.png", nb];
  NotebookClose[nb];
  fb = NotebookOpen[out <> "fallback.nb", Visible -> False];
  FrontEndTokenExecute[fb, "EvaluateInitialization"];
  Pause[20];
  Export[out <> "fallback-render.png", fb];
  g = NotebookGet[fb];
  NotebookClose[fb]];
Print["fallback after Evaluate Initialization Cells: ",
  Cases[g, Cell[c_, st_String, ___] :> {st, If[FreeQ[c, RasterBox], "-", "IMAGE"]}, Infinity] // Counts];
