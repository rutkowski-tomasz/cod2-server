// The Mod Tools' source formats, which their converter turns into game files: XMODEL_EXPORT (what the Maya plugin
// writes), TGA images and a GDT listing the assets.
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

// Our files' folder under model_export/ and texture/, so they stay apart from the Mod Tools' samples.
const FOLDER = 'modelimport'

const num = (x) => (Math.abs(x) < 5e-7 ? 0 : x).toFixed(6)
const commaList = (v) => v.map(num).join(', ')
const spacedList = (v) => v.map(num).join(' ')

// Writes the converter's input for one model and its animations into `work`, laid out as the Mod Tools' folders.
export function writeConverterInput(work, name, model, fps) {
  for (const dir of [`model_export/${FOLDER}`, `xanim_export/${FOLDER}`, `texture/${FOLDER}`, 'source_data']) mkdirSync(join(work, dir), { recursive: true })
  const modelFile = `${FOLDER}\\${name}.XMODEL_EXPORT`
  writeFileSync(join(work, 'model_export', FOLDER, `${name}.XMODEL_EXPORT`), xmodelExport(model))
  for (const m of model.materials) writeFileSync(join(work, 'texture', FOLDER, m.image), tga(m.pixels))
  writeAnimations(work, model.bones.map((b) => b.name), model.animations, fps)
  writeFileSync(join(work, 'source_data', `${name}.gdt`), gdt([
    { name, gdf: 'xmodel.gdf', fields: { type: model.bones.length > 1 ? 'animated' : 'rigid', filename: modelFile, calculateBounds: 1, collisionLOD: 'None' } },
    ...model.materials.map((m) => ({ name: m.name, gdf: 'material.gdf', fields: modelMaterial(m, `texture\\${FOLDER}\\${m.image}`) })),
    ...model.animations.map((a) => animationEntry(a, modelFile)),
  ]))
}

// Writes the converter's input for a gun: its viewmodel and world model, named after `name`, sharing materials.
export function writeWeaponInput(work, name, view, world) {
  for (const dir of [`model_export/${FOLDER}`, `texture/${FOLDER}`, 'source_data']) mkdirSync(join(work, dir), { recursive: true })
  // A rigid model keeps only its root bone, so a world model with tags is `animated`.
  const models = [[`viewmodel_${name}`, view, 'viewmodel'], [`weapon_${name}`, world, world.bones.length > 1 ? 'animated' : 'rigid']]
  for (const [file, model] of models) writeFileSync(join(work, 'model_export', FOLDER, `${file}.XMODEL_EXPORT`), xmodelExport(model))
  for (const m of view.materials) writeFileSync(join(work, 'texture', FOLDER, m.image), tga(m.pixels))
  writeFileSync(join(work, 'source_data', `${name}.gdt`), gdt([
    ...models.map(([file, , type]) => ({ name: file, gdf: 'xmodel.gdf', fields: { type, filename: `${FOLDER}\\${file}.XMODEL_EXPORT`, calculateBounds: 1, collisionLOD: 'None' } })),
    ...view.materials.map((m) => ({ name: m.name, gdf: 'material.gdf', fields: modelMaterial(m, `texture\\${FOLDER}\\${m.image}`) })),
  ]))
}

// Writes the converter's input for animations of another skeleton: `skeleton` gives its bones' names, parents and
// rest poses (position, axes). The converter builds them against an XMODEL_EXPORT of it, which needs a mesh: one
// triangle on the root bone.
export function writeAnimationsInput(work, name, skeleton, animations, fps) {
  for (const dir of [`model_export/${FOLDER}`, 'source_data']) mkdirSync(join(work, dir), { recursive: true })
  const rig = `${name}_rig`
  const corner = (vertex) => ({ vertex, normal: [0, 0, 1], color: [1, 1, 1, 1], uv: [0, 0] })
  writeFileSync(join(work, 'model_export', FOLDER, `${rig}.XMODEL_EXPORT`), xmodelExport({
    bones: skeleton.map((b) => ({ name: b.name, parent: b.parent, position: b.position.toArray(), axes: b.axes })),
    vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]].map((position) => ({ position, weights: [[0, 1]] })),
    faces: [{ object: 0, material: 0, corners: [corner(0), corner(2), corner(1)] }],
    objects: [rig],
    materials: [{ name: rig, image: `${rig}.tga` }],
  }))
  writeAnimations(work, skeleton.map((b) => b.name), animations, fps)
  writeFileSync(join(work, 'source_data', `${name}.gdt`), gdt(animations.map((a) => animationEntry(a, `${FOLDER}\\${rig}.XMODEL_EXPORT`))))
}

function writeAnimations(work, parts, animations, fps) {
  mkdirSync(join(work, 'xanim_export', FOLDER), { recursive: true })
  for (const a of animations) writeFileSync(join(work, 'xanim_export', FOLDER, `${a.name}.XANIM_EXPORT`), xanimExport(parts, fps, a.frames))
}

// `absolute` moves the bones about the scene's origin, where tag_origin stays; `model` gives the bind pose.
function animationEntry(a, modelFile) {
  return { name: a.name, gdf: 'xanim.gdf', fields: { filename: `${FOLDER}\\${a.name}.XANIM_EXPORT`, model: modelFile, looping: a.looping ? 1 : 0, type: 'absolute', useBones: 1 } }
}

// A lit model material. The converter wants a surface type, which sets impact effects and sounds.
function modelMaterial({ alpha, doubleSided }, colorMap) {
  return {
    template: 'material.template',
    materialType: 'model phong',
    surfaceType: '<none>',
    colorMap,
    ...(alpha === 'mask' && { alphaTest: 'GE128' }),
    ...(alpha === 'blend' && { blendFunc: 'Blend' }),
    ...(doubleSided && { cullFace: 'None' }),
  }
}

// `bones`: name, parent index (-1 for the root), position and X, Y, Z axes in model space.
// `vertices`: position and [bone, weight] pairs. `faces`: object and material index, and three corners
// (vertex index, normal, RGBA colour, uv), wound clockwise seen from outside.
function xmodelExport({ bones, vertices, faces, objects, materials }) {
  const out = ['MODEL', 'VERSION 6', '', `NUMBONES ${bones.length}`]
  bones.forEach((b, i) => out.push(`BONE ${i} ${b.parent} "${b.name}"`))
  out.push('')
  bones.forEach((b, i) => out.push(`BONE ${i}`, `OFFSET ${commaList(b.position)}`, 'SCALE 1.000000, 1.000000, 1.000000', `X ${commaList(b.axes[0])}`, `Y ${commaList(b.axes[1])}`, `Z ${commaList(b.axes[2])}`, ''))
  out.push(`NUMVERTS ${vertices.length}`)
  vertices.forEach((v, i) => {
    out.push(`VERT ${i}`, `OFFSET ${commaList(v.position)}`, `BONES ${v.weights.length}`)
    for (const [bone, w] of v.weights) out.push(`BONE ${bone} ${num(w)}`)
    out.push('')
  })
  out.push(`NUMFACES ${faces.length}`)
  for (const f of faces) {
    out.push(`TRI ${f.object} ${f.material} 0 0`)
    for (const c of f.corners) out.push(`VERT ${c.vertex}`, `NORMAL ${spacedList(c.normal)}`, `COLOR ${spacedList(c.color)}`, `UV 1 ${num(c.uv[0])} ${num(c.uv[1])}`)
  }
  out.push('', `NUMOBJECTS ${objects.length}`)
  objects.forEach((name, i) => out.push(`OBJECT ${i} "${name}"`))
  out.push('', `NUMMATERIALS ${materials.length}`)
  materials.forEach((m, i) => out.push(
    `MATERIAL ${i} "${m.name}" "Lambert" "${m.image}"`,
    'COLOR 0.000000 0.000000 0.000000 1.000000',
    'TRANSPARENCY 0.000000 0.000000 0.000000 1.000000',
    'AMBIENTCOLOR 0.000000 0.000000 0.000000 1.000000',
    'INCANDESCENCE 0.000000 0.000000 0.000000 1.000000',
    'COEFFS 0.800000 0.000000',
    'GLOW 0.000000 0',
    'REFRACTIVE 6 1.000000',
    'SPECULARCOLOR -1.000000 -1.000000 -1.000000 1.000000',
    'REFLECTIVECOLOR -1.000000 -1.000000 -1.000000 1.000000',
    'REFLECTIVE -1 -1.000000',
    'BLINN -1.000000 -1.000000',
    'PHONG -1.000000',
  ))
  return out.join('\n') + '\n'
}

// XANIM_EXPORT, as the Maya plugin writes it: per frame, every part's position and X, Y, Z axes in model space.
function xanimExport(parts, fps, frames) {
  const out = ['ANIMATION', 'VERSION 3', '', `NUMPARTS ${parts.length}`]
  parts.forEach((name, i) => out.push(`PART ${i} "${name}"`))
  out.push('', `FRAMERATE ${fps}`, `NUMFRAMES ${frames.length}`, '')
  frames.forEach((bones, f) => {
    out.push(`FRAME ${f}`)
    bones.forEach((b, i) => out.push(`PART ${i}`, `OFFSET ${spacedList(b.position)}`, 'SCALE 1 1 1', `X ${spacedList(b.axes[0])}`, `Y ${spacedList(b.axes[1])}`, `Z ${spacedList(b.axes[2])}`, ''))
  })
  out.push('NOTETRACKS', '')
  parts.forEach((_, i) => out.push(`PART ${i}`, 'NUMTRACKS 0', ''))
  return out.join('\n') + '\n'
}

// Uncompressed 32-bit TGA from RGBA rows, top row first.
function tga({ width, height, rgba }) {
  const out = Buffer.alloc(18 + width * height * 4)
  out[2] = 2
  out.writeUInt16LE(width, 12)
  out.writeUInt16LE(height, 14)
  out[16] = 32
  // 8 alpha bits; rows stored bottom first.
  out[17] = 8
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = ((height - 1 - y) * width + x) * 4
      const to = 18 + (y * width + x) * 4
      out[to] = rgba[from + 2]
      out[to + 1] = rgba[from + 1]
      out[to + 2] = rgba[from]
      out[to + 3] = rgba[from + 3]
    }
  }
  return out
}

// `entries`: name, gdf and its fields. Paths in fields use backslashes, as the converter runs under Windows.
function gdt(entries) {
  const out = ['{']
  for (const e of entries) {
    out.push(`\t"${e.name}" ( "${e.gdf}" )`, '\t{')
    for (const [k, v] of Object.entries(e.fields)) out.push(`\t\t"${k}" "${String(v).replaceAll('\\', '\\\\')}"`)
    out.push('\t}')
  }
  out.push('}')
  return out.join('\n') + '\n'
}
