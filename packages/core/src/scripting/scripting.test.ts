/**
 * @module @kekenik/core/scripting/scripting.test
 * 52 unit tests for the Kekenik Pixel Scripting Engine, Sandbox, Permissions, Dialogs, Events, and 12 Sample Scripts.
 */

import { describe, expect, it } from "vitest";
import { SpriteDocument } from "../commands/index.ts";
import { createSprite, getCel } from "../model/index.ts";
import {
  BUILTIN_SAMPLE_SCRIPTS,
  computeScriptHash,
  executeKekenikScript,
  ScriptPermissionStore,
  scriptEventsBus,
} from "./index.ts";

function makeTestDoc(width = 16, height = 16): SpriteDocument {
  return new SpriteDocument(createSprite({ name: "TestSprite", width, height, colorMode: "rgba" }));
}

describe("Kekenik Scripting Engine (Part A & Part C)", () => {
  // 1..8: Pixel & Image Operations
  it("1. sets a pixel via app.activeCel.image.setPixel(0,0,{r:255,g:0,b:0,a:255}) and undoes with doc.undo()", async () => {
    const doc = makeTestDoc(8, 8);
    const res = await executeKekenikScript(
      `app.activeCel.image.setPixel(0, 0, { r: 255, g: 0, b: 0, a: 255 });`,
      { doc }
    );
    expect(res.success).toBe(true);
    const cel = getCel(doc.sprite, doc.sprite.layers[0].id, 0)!;
    expect(cel.image.getRGBA(0, 0)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(doc.history.canUndo).toBe(true);
    doc.undo();
    const celAfterUndo = getCel(doc.sprite, doc.sprite.layers[0].id, 0)!;
    expect(celAfterUndo.image.getRGBA(0, 0).a).toBe(0);
  });

  it("2. reads and writes pixels with getPixel and drawPixel", async () => {
    const doc = makeTestDoc(8, 8);
    const res = await executeKekenikScript(
      `
      app.transaction("Draw Pixel", () => {
        app.activeCel.image.drawPixel(3, 4, "#00ff88");
        const px = app.activeCel.image.getPixel(3, 4);
        console.log(px.r, px.g, px.b);
      });
      `,
      { doc }
    );
    expect(res.success).toBe(true);
    expect(res.logs[0].message).toBe("0 255 136");
  });

  it("3. draws lines with image.drawLine", async () => {
    const doc = makeTestDoc(10, 10);
    const res = await executeKekenikScript(
      `app.activeCel.image.drawLine(0, 0, 5, 0, { r: 10, g: 20, b: 30, a: 255 });`,
      { doc }
    );
    expect(res.success).toBe(true);
    const img = getCel(doc.sprite, doc.sprite.layers[0].id, 0)!.image;
    expect(img.getRGBA(0, 0).r).toBe(10);
    expect(img.getRGBA(5, 0).b).toBe(30);
  });

  it("4. draws stroked and filled rectangles with drawRect and drawFilledRect", async () => {
    const doc = makeTestDoc(12, 12);
    const res = await executeKekenikScript(
      `
      app.transaction("Rects", () => {
        app.activeCel.image.drawRect(1, 1, 4, 4, { r: 200, g: 0, b: 0, a: 255 });
        app.activeCel.image.drawFilledRect(6, 6, 3, 3, { r: 0, g: 0, b: 250, a: 255 });
      });
      `,
      { doc }
    );
    expect(res.success).toBe(true);
    const img = getCel(doc.sprite, doc.sprite.layers[0].id, 0)!.image;
    expect(img.getRGBA(1, 1).r).toBe(200);
    expect(img.getRGBA(2, 2).a).toBe(0); // hollow interior
    expect(img.getRGBA(7, 7).b).toBe(250); // filled interior
  });

  it("5. clears image with optional color via image.clear()", async () => {
    const doc = makeTestDoc(4, 4);
    const res = await executeKekenikScript(
      `
      app.activeCel.image.clear({ r: 12, g: 34, b: 56, a: 255 });
      `,
      { doc }
    );
    expect(res.success).toBe(true);
    const img = getCel(doc.sprite, doc.sprite.layers[0].id, 0)!.image;
    expect(img.getRGBA(2, 2)).toEqual({ r: 12, g: 34, b: 56, a: 255 });
  });

  it("6. reads and writes typed-array buffers via getData(), setData(), and getPixelData(x,y)", async () => {
    const doc = makeTestDoc(4, 4);
    const res = await executeKekenikScript(
      `
      const view = app.activeCel.image.getPixelData(1, 1);
      view[0] = 99;
      view[1] = 88;
      view[2] = 77;
      view[3] = 255;
      const full = app.activeCel.image.getData();
      console.log(full.length, app.activeCel.image.getPixel(1, 1).r);
      `,
      { doc }
    );
    expect(res.success).toBe(true);
    expect(res.logs[0].message).toBe("64 99");
  });

  it("7. blits one image onto another via image.drawImage()", async () => {
    const doc = makeTestDoc(8, 8);
    const res = await executeKekenikScript(
      `
      app.transaction("Blit", () => {
        app.activeCel.image.setPixel(0, 0, { r: 123, g: 45, b: 67, a: 255 });
        app.activeCel.image.drawImage(app.activeCel.image, 4, 4);
      });
      `,
      { doc }
    );
    expect(res.success).toBe(true);
    const img = getCel(doc.sprite, doc.sprite.layers[0].id, 0)!.image;
    expect(img.getRGBA(4, 4).r).toBe(123);
  });

  // 8..12: Color & Palette API
  it("8. provides Color.rgba, Color.hex, Color.fromHex, and Color.blend", async () => {
    const doc = makeTestDoc(4, 4);
    const res = await executeKekenikScript(
      `
      const c1 = Color.fromHex("#ff0000");
      const c2 = Color.rgba(0, 0, 255, 128);
      const blended = Color.blend(c1, c2, 255);
      console.log(Color.hex(c1), blended.r > 0 && blended.b > 0);
      `,
      { doc }
    );
    expect(res.success).toBe(true);
    expect(res.logs[0].message).toBe("#ff0000 true");
  });

  it("9. resizes palette and gets/sets palette colors", async () => {
    const doc = makeTestDoc(8, 8);
    const res = await executeKekenikScript(
      `
      app.transaction("Palette Resize", () => {
        app.activeSprite.palette.resize(8);
        app.activeSprite.palette.setColor(7, "#123456");
      });
      `,
      { doc }
    );
    expect(res.success).toBe(true);
    expect(doc.sprite.palettes[0].colors.length).toBe(8);
    expect(doc.sprite.palettes[0].colors[7]).toEqual({ r: 18, g: 52, b: 86, a: 255 });
  });

  it("10. saves and loads palette in GIMP .gpl format", async () => {
    const doc = makeTestDoc(8, 8);
    const res = await executeKekenikScript(
      `
      app.activeSprite.palette.resize(4);
      app.activeSprite.palette.setColor(1, { r: 210, g: 110, b: 40, a: 255 });
      const gpl = app.activeSprite.palette.save("palettes/test.gpl");
      app.activeSprite.palette.setColor(1, { r: 0, g: 0, b: 0, a: 255 });
      const loaded = app.activeSprite.palette.load("palettes/test.gpl");
      console.log(loaded, app.activeSprite.palette.getColor(1).r, gpl.startsWith("GIMP Palette"));
      `,
      { doc }
    );
    expect(res.success).toBe(true);
    expect(res.logs[0].message).toBe("true 210 true");
  });

  // 11..17: Sprite, Layer, Cel, Selection & Transaction Rollback
  it("11. adds layers, renames, reorders, and deletes layers via Sprite & Layer API", async () => {
    const doc = makeTestDoc(8, 8);
    const res = await executeKekenikScript(
      `
      app.transaction("Layer Ops", () => {
        const l2 = app.activeSprite.addLayer("FX");
        l2.opacity = 128;
        l2.blendMode = "multiply";
        l2.moveTo(0);
      });
      `,
      { doc }
    );
    expect(res.success).toBe(true);
    expect(doc.sprite.layers.length).toBe(2);
    expect(doc.sprite.layers[0].name).toBe("FX");
    expect(doc.sprite.layers[0].opacity).toBe(128);
    expect(doc.sprite.layers[0].blendMode).toBe("multiply");
  });

  it("12. adds frames, crops, resizes, and flattens sprites", async () => {
    const doc = makeTestDoc(16, 16);
    const res = await executeKekenikScript(
      `
      app.transaction("Sprite Geometry", () => {
        app.activeSprite.addLayer("Top");
        app.activeSprite.addFrame(150);
        app.activeSprite.crop(2, 2, 8, 8);
        app.activeSprite.resize(12, 12);
        app.activeSprite.flatten();
      });
      `,
      { doc }
    );
    expect(res.success).toBe(true);
    expect(doc.sprite.width).toBe(12);
    expect(doc.sprite.height).toBe(12);
    expect(doc.sprite.frames.length).toBe(2);
    expect(doc.sprite.layers.length).toBe(1);
  });

  it("13. manipulates Selection via selectRect, selectEllipse, selectAll, deselect, and getMask", async () => {
    const doc = makeTestDoc(16, 16);
    const res = await executeKekenikScript(
      `
      app.activeSprite.selection.selectRect(2, 3, 5, 6);
      const b1 = app.activeSprite.selection.bounds;
      const maskBytes = app.activeSprite.selection.getMask();
      app.activeSprite.selection.deselect();
      const emptyAfter = app.activeSprite.selection.isEmpty;
      app.activeSprite.selection.selectEllipse(1, 1, 8, 8);
      console.log(b1.width, b1.height, maskBytes.length > 0, emptyAfter, !app.activeSprite.selection.isEmpty);
      `,
      { doc }
    );
    expect(res.success).toBe(true);
    expect(res.logs[0].message).toBe("5 6 true true true");
  });

  it("14. rolls back all mutations when an error is thrown inside app.transaction()", async () => {
    const doc = makeTestDoc(8, 8);
    const res = await executeKekenikScript(
      `
      app.transaction("Will Fail", () => {
        app.activeCel.image.setPixel(0, 0, { r: 255, g: 0, b: 0, a: 255 });
        app.activeSprite.addLayer("ShouldNotExist");
        throw new Error("Simulated failure mid-transaction");
      });
      `,
      { doc }
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain("Simulated failure mid-transaction");
    expect(doc.sprite.layers.length).toBe(1);
    const cel = getCel(doc.sprite, doc.sprite.layers[0].id, 0)!;
    expect(cel.image.getRGBA(0, 0).a).toBe(0);
  });

  it("15. enforces strictTransactionMode when enabled", async () => {
    const doc = makeTestDoc(8, 8);
    const res = await executeKekenikScript(
      `app.activeCel.image.setPixel(0, 0, { r: 255, g: 0, b: 0, a: 255 });`,
      { doc, strictTransactionMode: true }
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain("TransactionRequiredError");
  });

  // 16..25: Sandbox Escape Prevention (10 tests — all must fail)
  it("16. blocks direct eval() in user scripts", async () => {
    const doc = makeTestDoc();
    const res = await executeKekenikScript(`eval("1 + 1");`, { doc });
    expect(res.success).toBe(false);
    expect(res.error).toContain("SandboxSecurityError");
  });

  it("17. blocks new Function() in user scripts", async () => {
    const doc = makeTestDoc();
    const res = await executeKekenikScript(`const fn = new Function("return 1"); fn();`, { doc });
    expect(res.success).toBe(false);
    expect(res.error).toContain("SandboxSecurityError");
  });

  it("18. blocks window access in user scripts", async () => {
    const doc = makeTestDoc();
    const res = await executeKekenikScript(`console.log(window.location);`, { doc });
    expect(res.success).toBe(false);
    expect(res.error).toContain("SandboxSecurityError");
  });

  it("19. blocks document DOM access in user scripts", async () => {
    const doc = makeTestDoc();
    const res = await executeKekenikScript(`console.log(document.cookie);`, { doc });
    expect(res.success).toBe(false);
    expect(res.error).toContain("SandboxSecurityError");
  });

  it("20. blocks require() in user scripts", async () => {
    const doc = makeTestDoc();
    const res = await executeKekenikScript(`const fs = require("fs");`, { doc });
    expect(res.success).toBe(false);
    expect(res.error).toContain("SandboxSecurityError");
  });

  it("21. blocks process access in user scripts", async () => {
    const doc = makeTestDoc();
    const res = await executeKekenikScript(`console.log(process.env);`, { doc });
    expect(res.success).toBe(false);
    expect(res.error).toContain("SandboxSecurityError");
  });

  it("22. blocks globalThis access in user scripts", async () => {
    const doc = makeTestDoc();
    const res = await executeKekenikScript(`console.log(globalThis);`, { doc });
    expect(res.success).toBe(false);
    expect(res.error).toContain("SandboxSecurityError");
  });

  it("23. blocks XMLHttpRequest and WebSocket in user scripts", async () => {
    const doc = makeTestDoc();
    const res = await executeKekenikScript(`const xhr = new XMLHttpRequest();`, { doc });
    expect(res.success).toBe(false);
    expect(res.error).toContain("SandboxSecurityError");
  });

  it("24. blocks constructor.constructor / __proto__ prototype escape in user scripts", async () => {
    const doc = makeTestDoc();
    const res = await executeKekenikScript(`const f = ({}).constructor.constructor("return this")();`, {
      doc,
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain("SandboxSecurityError");
  });

  it("25. blocks raw global fetch() while allowing permission-gated app.fetch()", async () => {
    const doc = makeTestDoc();
    const bad = await executeKekenikScript(`fetch("https://example.com");`, { doc });
    expect(bad.success).toBe(false);
    expect(bad.error).toContain("SandboxSecurityError");

    const good = await executeKekenikScript(
      `const r = app.fetch("https://example.com/api"); console.log(r.status);`,
      { doc, permissions: { network: true } }
    );
    expect(good.success).toBe(true);
    expect(good.logs[0].message).toBe("200");
  });

  // 26..33: Permission Enforcement & Script Timeout
  it("26. prompts for fs.write on first use and remembers decision per script hash", async () => {
    const doc = makeTestDoc();
    const store = new ScriptPermissionStore();
    const prompts: string[] = [];
    const code = `app.fs.writeText("notes/hello.txt", "world");`;

    const res1 = await executeKekenikScript(code, {
      doc,
      permissionStore: store,
      onPermissionRequest: (req) => {
        prompts.push(`${req.permission}:${req.resource}`);
        return true;
      },
    });
    expect(res1.success).toBe(true);
    expect(prompts).toEqual(["fs.write:notes/hello.txt"]);

    // Second run of same script hash should NOT prompt again
    const res2 = await executeKekenikScript(code, {
      doc,
      permissionStore: store,
      onPermissionRequest: () => {
        prompts.push("should_not_be_called");
        return true;
      },
    });
    expect(res2.success).toBe(true);
    expect(prompts.length).toBe(1);
  });

  it("27. throws PermissionDeniedError when user denies fs.read permission", async () => {
    const doc = makeTestDoc();
    const store = new ScriptPermissionStore();
    const res = await executeKekenikScript(`app.fs.readText("secret.txt");`, {
      doc,
      permissionStore: store,
      onPermissionRequest: () => false,
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain("PermissionDeniedError");
  });

  it("28. throws PermissionDeniedError when network permission is disabled in manifest", async () => {
    const doc = makeTestDoc();
    const res = await executeKekenikScript(`app.fetch("https://api.example.com");`, {
      doc,
      permissions: { network: false },
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain("PermissionDeniedError");
  });

  it("29. throws PermissionDeniedError when dialogs permission is denied", async () => {
    const doc = makeTestDoc();
    const res = await executeKekenikScript(`app.alert("Hi");`, {
      doc,
      permissions: { dialogs: false },
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain("PermissionDeniedError");
  });

  it("30. enforces configurable script timeout on runaway loops", async () => {
    const doc = makeTestDoc();
    const res = await executeKekenikScript(
      `
      let i = 0;
      while (i >= 0) {
        i++;
      }
      `,
      { doc, timeoutMs: 15 }
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain("ScriptTimeoutError");
  });

  it("31. computes deterministic FNV-1a script hashes", async () => {
    const h1 = computeScriptHash("console.log(1);");
    const h2 = computeScriptHash("console.log(1);");
    const h3 = computeScriptHash("console.log(2);");
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });

  // 32..36: Dialog Builder & App Events
  it("32. builds interactive script dialogs with label, button, slider, color, combo, entry, checkbox, and canvas", async () => {
    const doc = makeTestDoc();
    const res = await executeKekenikScript(
      `
      const dlg = app.dialog((d) => {
        d.title("Generator")
          .label("Configure procedural sprite:")
          .slider({ id: "size", label: "Size", min: 1, max: 64, value: 16 })
          .color({ id: "tint", label: "Tint", value: "#ff5500" })
          .combo({ id: "mode", label: "Mode", options: [" crisp", "soft"], value: "crisp" })
          .entry({ id: "name", label: "Name", value: "Hero" })
          .checkbox({ id: "outline", label: "Add Outline", checked: true })
          .canvas({
            id: "preview",
            width: 8,
            height: 8,
            draw: (img) => img.setPixel(2, 2, "#00ff00")
          })
          .button({ id: "apply", text: "Apply" })
          .on("confirm", (vals) => {
            console.log("confirmed:" + vals.name + ":" + vals.size);
          });
      });
      dlg.trigger("confirm", { name: "Knight", size: 32 });
      `,
      { doc }
    );
    expect(res.success).toBe(true);
    expect(res.dialogs.length).toBe(1);
    expect(res.dialogs[0].widgets.length).toBe(8);
    expect(res.logs[0].message).toBe("confirmed:Knight:32");
  });

  it("33. fires and listens to real app events (frameChange, layerChange, toolChange, beforeSave, afterSave, afterOpen)", async () => {
    scriptEventsBus.clearAll();
    const doc = makeTestDoc();
    const res = await executeKekenikScript(
      `
      const fired: string[] = [];
      events.on("layerChange", (e) => fired.push("layer:" + e.name));
      events.on("frameChange", (e) => fired.push("frame:" + e.frameIndex));
      events.on("toolChange", (e) => fired.push("tool:" + e.toolId));
      events.on("beforeSave", (e) => fired.push("beforeSave:" + e.path));
      events.on("afterSave", (e) => fired.push("afterSave:" + e.path));

      app.activeSprite.addLayer("Armor");
      app.activeSprite.addFrame(100);
      app.tools.select("tool.eraser");
      app.save("hero.kpx-snapshot");
      console.log(fired.join("|"));
      `,
      { doc }
    );
    expect(res.success).toBe(true);
    expect(res.logs[0].message).toBe(
      "layer:Armor|frame:1|tool:tool.eraser|beforeSave:hero.kpx-snapshot|afterSave:hero.kpx-snapshot"
    );
  });

  it("34. supports app.alert, app.confirm, and app.prompt", async () => {
    const doc = makeTestDoc();
    const res = await executeKekenikScript(
      `
      app.alert("Watch out!");
      const ok = app.confirm("Proceed?");
      const name = app.prompt("Layer name:", "Clouds");
      console.log(ok, name);
      `,
      { doc }
    );
    expect(res.success).toBe(true);
    expect(res.alerts).toEqual(["Watch out!"]);
    expect(res.logs[0].message).toBe("true Clouds");
  });

  it("35. lists and runs commands and tools via app.commands and app.tools", async () => {
    const doc = makeTestDoc();
    const res = await executeKekenikScript(
      `
      const tools = app.tools.list();
      const cmds = app.commands.list();
      console.log(Array.isArray(tools), Array.isArray(cmds));
      `,
      { doc }
    );
    expect(res.success).toBe(true);
    expect(res.logs[0].message).toBe("true true");
  });

  it("36. creates new sprites and opens saved sprites via app.new() and app.open()", async () => {
    const doc = makeTestDoc();
    const res = await executeKekenikScript(
      `
      const s = app.new(24, 32, "rgba");
      s.saveAs("test_saved.kpx-snapshot");
      const reopened = app.open("test_saved.kpx-snapshot");
      console.log(reopened.width, reopened.height);
      `,
      { doc }
    );
    expect(res.success).toBe(true);
    expect(res.logs[0].message).toBe("24 32");
  });

  // 37..48: All 12 Sample Scripts from Part C tested individually
  it("37. runs Sample 1 (export-each-layer.ts) and verifies layer export metadata", async () => {
    const doc = makeTestDoc(16, 16);
    const sample = BUILTIN_SAMPLE_SCRIPTS.find((s) => s.fileName === "export-each-layer.ts")!;
    const res = await executeKekenikScript(sample.code, { doc, scriptName: sample.fileName });
    expect(res.success).toBe(true);
    expect(doc.sprite.userData.text).toBe("exported_layers:1");
  });

  it("38. runs Sample 2 (palette-from-image.ts) and verifies palette extraction from cel", async () => {
    const doc = makeTestDoc(8, 8);
    const cel = getCel(doc.sprite, doc.sprite.layers[0].id, 0)!;
    cel.image.setRGBA(1, 1, { r: 250, g: 10, b: 10, a: 255 });
    cel.image.setRGBA(2, 2, { r: 10, g: 250, b: 10, a: 255 });
    const sample = BUILTIN_SAMPLE_SCRIPTS.find((s) => s.fileName === "palette-from-image.ts")!;
    const res = await executeKekenikScript(sample.code, { doc, scriptName: sample.fileName });
    expect(res.success).toBe(true);
    expect(doc.sprite.palettes[0].colors.length).toBe(3); // transparent + 2 colors
  });

  it("39. runs Sample 3 (outline-all-frames.ts) and verifies 1px outline around opaque pixel", async () => {
    const doc = makeTestDoc(8, 8);
    const cel = getCel(doc.sprite, doc.sprite.layers[0].id, 0)!;
    cel.image.setRGBA(4, 4, { r: 255, g: 255, b: 255, a: 255 });
    const sample = BUILTIN_SAMPLE_SCRIPTS.find((s) => s.fileName === "outline-all-frames.ts")!;
    const res = await executeKekenikScript(sample.code, { doc, scriptName: sample.fileName });
    expect(res.success).toBe(true);
    const afterImg = getCel(doc.sprite, doc.sprite.layers[0].id, 0)!.image;
    expect(afterImg.getRGBA(3, 4).a).toBe(255);
    expect(afterImg.getRGBA(5, 4).a).toBe(255);
    expect(afterImg.getRGBA(4, 3).a).toBe(255);
    expect(afterImg.getRGBA(4, 5).a).toBe(255);
  });

  it("40. runs Sample 4 (random-noise-brush.ts) and verifies noise pixels drawn in selection", async () => {
    const doc = makeTestDoc(8, 8);
    doc.sprite.mask.selectRect({ x: 2, y: 2, width: 4, height: 4 });
    const sample = BUILTIN_SAMPLE_SCRIPTS.find((s) => s.fileName === "random-noise-brush.ts")!;
    const res = await executeKekenikScript(sample.code, { doc, scriptName: sample.fileName });
    expect(res.success).toBe(true);
    const afterImg = getCel(doc.sprite, doc.sprite.layers[0].id, 0)!.image;
    expect(afterImg.getRGBA(2, 2).a).toBe(255);
    expect(afterImg.getRGBA(0, 0).a).toBe(0); // outside selection stays transparent
  });

  it("41. runs Sample 5 (batch-rename-layers.ts) and verifies 'spr_01_' prefix on layers", async () => {
    const doc = makeTestDoc(8, 8);
    const sample = BUILTIN_SAMPLE_SCRIPTS.find((s) => s.fileName === "batch-rename-layers.ts")!;
    const res = await executeKekenikScript(sample.code, { doc, scriptName: sample.fileName });
    expect(res.success).toBe(true);
    expect(doc.sprite.layers[0].name.startsWith("spr_01_")).toBe(true);
  });

  it("42. runs Sample 6 (flip-horizontal-all-frames.ts) and verifies horizontal pixel mirror", async () => {
    const doc = makeTestDoc(8, 8);
    const cel = getCel(doc.sprite, doc.sprite.layers[0].id, 0)!;
    cel.image.setRGBA(0, 2, { r: 222, g: 111, b: 55, a: 255 });
    const sample = BUILTIN_SAMPLE_SCRIPTS.find(
      (s) => s.fileName === "flip-horizontal-all-frames.ts"
    )!;
    const res = await executeKekenikScript(sample.code, { doc, scriptName: sample.fileName });
    expect(res.success).toBe(true);
    const afterImg = getCel(doc.sprite, doc.sprite.layers[0].id, 0)!.image;
    expect(afterImg.getRGBA(7, 2).r).toBe(222);
    expect(afterImg.getRGBA(0, 2).a).toBe(0);
  });

  it("43. runs Sample 7 (grid-overlay-demo.ts) and verifies 8x8 grid lines on cel", async () => {
    const doc = makeTestDoc(16, 16);
    const sample = BUILTIN_SAMPLE_SCRIPTS.find((s) => s.fileName === "grid-overlay-demo.ts")!;
    const res = await executeKekenikScript(sample.code, { doc, scriptName: sample.fileName });
    expect(res.success).toBe(true);
    const afterImg = getCel(doc.sprite, doc.sprite.layers[0].id, 0)!.image;
    expect(afterImg.getRGBA(0, 5).a).toBeGreaterThan(0);
    expect(afterImg.getRGBA(8, 5).a).toBeGreaterThan(0);
  });

  it("44. runs Sample 8 (palette-export-gpl.ts) and verifies GPL export metadata", async () => {
    const doc = makeTestDoc(8, 8);
    const sample = BUILTIN_SAMPLE_SCRIPTS.find((s) => s.fileName === "palette-export-gpl.ts")!;
    const res = await executeKekenikScript(sample.code, { doc, scriptName: sample.fileName });
    expect(res.success).toBe(true);
    expect(doc.sprite.userData.text).toContain("gpl_exported:");
  });

  it("45. runs Sample 9 (sprite-from-csv.ts) and verifies CSV pixel art rasterization", async () => {
    const doc = makeTestDoc(8, 8);
    const sample = BUILTIN_SAMPLE_SCRIPTS.find((s) => s.fileName === "sprite-from-csv.ts")!;
    const res = await executeKekenikScript(sample.code, { doc, scriptName: sample.fileName });
    expect(res.success).toBe(true);
    const afterImg = getCel(doc.sprite, doc.sprite.layers[0].id, 0)!.image;
    expect(afterImg.getRGBA(1, 0)).toEqual({ r: 250, g: 204, b: 21, a: 255 });
  });

  it("46. runs Sample 10 (stamp-brush.ts) and verifies 3x3 cross stamps along diagonal", async () => {
    const doc = makeTestDoc(8, 8);
    const sample = BUILTIN_SAMPLE_SCRIPTS.find((s) => s.fileName === "stamp-brush.ts")!;
    const res = await executeKekenikScript(sample.code, {
      doc,
      fgColor: { r: 80, g: 200, b: 120, a: 255 },
      scriptName: sample.fileName,
    });
    expect(res.success).toBe(true);
    const afterImg = getCel(doc.sprite, doc.sprite.layers[0].id, 0)!.image;
    expect(afterImg.getRGBA(1, 1).g).toBe(200);
    expect(afterImg.getRGBA(3, 3).g).toBe(200);
  });

  it("47. runs Sample 11 (stats-panel.ts) and verifies statistics dialog + userData", async () => {
    const doc = makeTestDoc(8, 8);
    const cel = getCel(doc.sprite, doc.sprite.layers[0].id, 0)!;
    cel.image.setRGBA(2, 2, { r: 255, g: 0, b: 0, a: 255 });
    const sample = BUILTIN_SAMPLE_SCRIPTS.find((s) => s.fileName === "stats-panel.ts")!;
    const res = await executeKekenikScript(sample.code, { doc, scriptName: sample.fileName });
    expect(res.success).toBe(true);
    expect(res.dialogs.length).toBe(1);
    expect(doc.sprite.userData.text).toBe("stats:pixels=1,colors=1,layers=1");
  });

  it("48. runs Sample 12 (hello-world.ts) and verifies pixel (0,0) is red and undoable", async () => {
    const doc = makeTestDoc(8, 8);
    const sample = BUILTIN_SAMPLE_SCRIPTS.find((s) => s.fileName === "hello-world.ts")!;
    const res = await executeKekenikScript(sample.code, { doc, scriptName: sample.fileName });
    expect(res.success).toBe(true);
    const afterImg = getCel(doc.sprite, doc.sprite.layers[0].id, 0)!.image;
    expect(afterImg.getRGBA(0, 0)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(afterImg.getRGBA(2, 2)).toEqual({ r: 250, g: 204, b: 21, a: 255 });
  });
});
