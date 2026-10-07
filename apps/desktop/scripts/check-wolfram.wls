(* The kernel's half of check-wolfram.ts (port-only: docs/PARITY.md): wolframscript -file check-wolfram.wls <folder>.
   Gets what the app wrote — engine.nb, fallback.nb, clip-*.txt, linear.txt — and checks that each is what it should be:
   a Notebook of the expected styles, every image an Image of the right size, every fallback cell closed and making
   the same image, maths that parses back to its source, and the clipboard's cells and linear syntax parsing back to
   an Image. Each image is exported as a PNG, in <folder>/png, for a person to look at. Exit 1 when anything failed. *)
out = $ScriptCommandLine[[2]];
expected = Import[out <> "/expected.json", "RawJSON"];
SetDirectory[out];
CreateDirectory["png"];
fails = 0;
check[label_String, ok_] := If[TrueQ[ok], Print["  ok   ", label], fails++; Print["  FAIL ", label]];
ascii[f_] := Max[Normal[ReadByteArray[f]]] < 128;
tagOf[c_] := Replace[Cases[c, ("WriteMind" -> k_String) :> k, Infinity], {{k_, ___} :> k, {} -> None}];
opts[c_Cell] := Drop[List @@ c, 2];
sizeOf[i_] := Replace[ImageSize /. Options[i], {n_?NumericQ :> {n, Automatic}, {w_, h_} :> {w, h}}];
near[a_, b_, tol_ : 1.5] := Abs[a - b] <= tol;
imageTags = {"ink", "floating", "picture"};
png[name_, i_] := Export["png/" <> name <> ".png", i];

checkImage[label_, i_, spec_] := Module[{w, h, d},
  {w, h} = spec["size"]; d = spec["scale"];
  check[label <> " is an Image", ImageQ[i]];
  If[ImageQ[i],
    check[label <> " has " <> ToString[d w] <> "x" <> ToString[d h] <> " pixels (got " <> ToString[ImageDimensions[i]] <> ")",
      near[ImageDimensions[i][[1]], d w, 2] && near[ImageDimensions[i][[2]], d h, 2]];
    check[label <> " is shown " <> ToString[w] <> " points wide (got " <> ToString[sizeOf[i][[1]]] <> ")",
      near[sizeOf[i][[1]], w, 1.5]]]];

(* ---- the two notebooks ---- *)
Do[
  Print[file, ":"];
  nb = Get[file];
  check["is a Notebook", Head[nb] === Notebook];
  check["is 7-bit ASCII", ascii[file]];
  cells = First[nb];
  styles = (#[[2]] &) /@ cells;
  Print["  cells by style: ", Normal[Counts[styles]]];
  check["the styles are the fixture's, in order", styles === expected["styles"][StringReplace[file, ".nb" -> ""]]];
  images = Select[cells, MemberQ[imageTags, tagOf[#]] &];
  check["has " <> ToString[Length[expected["images"]]] <> " image cells", Length[images] === Length[expected["images"]]];
  check["the image cells are the fixture's kinds, in order", (tagOf /@ images) === (#["tag"] & /@ expected["images"])];
  Do[
    With[{c = images[[k]], spec = expected["images"][[k]]},
      With[{label = "image " <> ToString[k] <> " (" <> spec["tag"] <> ")"},
        If[file === "engine.nb",
          check[label <> " is an Output cell that re-running the Input above it keeps",
            c[[2]] === "Output" && MemberQ[opts[c], GeneratedCell -> False] && MemberQ[opts[c], CellAutoOverwrite -> False]];
          With[{i = Quiet@ToExpression[c[[1, 1]]]}, checkImage[label, i, spec]; If[ImageQ[i], png[StringReplace[file, ".nb" -> ""] <> "-" <> ToString[k] <> "-" <> spec["tag"], i]]],
          check[label <> " is a CLOSED initialization Input cell",
            c[[2]] === "Input" && MemberQ[opts[c], CellOpen -> False] && MemberQ[opts[c], InitializationCell -> True]];
          With[{i = Quiet@ToExpression[c[[1, 1]]]}, checkImage[label <> " (evaluated)", i, spec]; If[ImageQ[i], png["fallback-" <> ToString[k] <> "-" <> spec["tag"], i]]]]]],
    {k, Length[images]}];
  (* maths: what the file holds parses back to the source it was made from (the held reading) *)
  maths = Cases[cells, Cell[BoxData[b_], "InlineFormula"] | Cell[BoxData[b_], "Input", ___, TaggingRules -> {"WriteMind" -> "maths"}] :> b, Infinity];
  check["has " <> ToString[Length[expected["maths"]]] <> " maths cells", Length[maths] === Length[expected["maths"]]];
  Do[check["maths " <> ToString[k] <> ": " <> expected["maths"][[k]],
      MakeExpression[maths[[k]], StandardForm] === ToExpression[expected["maths"][[k]], InputForm, HoldComplete]],
    {k, Min[Length[maths], Length[expected["maths"]]]}];
  (* what the front end would run if the Input above an image were run: nothing of ours is an initialization cell but the images *)
  inits = Select[cells, MemberQ[opts[#], InitializationCell -> True] &];
  check["only the image fallbacks are initialization cells",
    If[file === "engine.nb", inits === {}, Length[inits] === Length[images] && SubsetQ[images, inits]]],
  {file, {"engine.nb", "fallback.nb"}}];

(* ---- the clipboard ---- *)
Print["clipboard:"];
spec = <|"size" -> expected["clipSize"], "scale" -> 2|>;
one = ToExpression[ReadString["clip-one.txt"]];
check["clip-one is one Cell", Head[one] === Cell && one[[2]] === "Output"];
With[{i = Quiet@ToExpression[one[[1, 1]]]}, checkImage["clip-one", i, spec]; If[ImageQ[i], png["clip-one", i]]];
two = ToExpression[ReadString["clip-two.txt"]];
check["clip-two is a list of two Cells (Text, Output)", MatchQ[two, {_Cell, _Cell}] && (#[[2]] & /@ two) === {"Text", "Output"}];
With[{i = Quiet@ToExpression[two[[2, 1, 1]]]}, checkImage["clip-two image", i, spec]];
fb = ToExpression[ReadString["clip-fallback.txt"]];
check["clip-fallback is an OPEN Input cell that is not an initialization cell",
  fb[[2]] === "Input" && FreeQ[opts[fb], CellOpen -> False] && FreeQ[opts[fb], InitializationCell -> True]];
With[{i = Quiet@ToExpression[fb[[1, 1]]]}, checkImage["clip-fallback (evaluated)", i, spec]];
linear = ToExpression[ReadString["linear.txt"]];
check["the linear syntax parses to an Image", ImageQ[linear]];
If[ImageQ[linear], checkImage["linear syntax", linear, spec]; png["linear", linear]];
If[FileExistsQ["clip-one.png"],
  With[{p = Import["clip-one.png", "Image"]}, check["the clipboard's PNG is the image at 2 pixels a point", near[ImageDimensions[p][[1]], 2 expected["clipSize"][[1]], 2]]],
  check["the clipboard's PNG exists", False]];

Print[If[fails === 0, "ALL OK", ToString[fails] <> " FAILED"]];
Exit[If[fails === 0, 0, 1]];
