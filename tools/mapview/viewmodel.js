// The viewmodel pass: what an add-on shows at the eye, such as a player's hands and gun, drawn over the world in a
// pass of its own, as the game draws the gun, so it never sinks into a wall. It stays in the world's frame, at the
// eye, so on pages lit by lightmaps the world's sun lights it as it lights models. THREE comes from the page script.

// The viewmodel sits a few units from the eye, inside the world camera's near plane.
const NEAR = 1

export function createViewmodelPass(renderer) {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera()
  // Turns CoD's view frame (X forward, Y left, Z up), already turned Y-up by an actor's own group, to the camera's.
  const holder = new THREE.Group()
  holder.rotation.y = Math.PI / 2
  const eye = new THREE.Group()
  eye.add(holder)
  scene.add(eye)

  return {
    set(object) {
      holder.clear()
      if (object) holder.add(object)
    },
    shown: () => holder.children.length > 0,
    // Moves the viewmodel to `cam`'s eye; done before anything reads its bones' positions in a frame.
    place(cam) {
      eye.position.copy(cam.position)
      eye.quaternion.copy(cam.quaternion)
    },
    draw(cam) {
      camera.copy(cam)
      camera.near = NEAR
      camera.updateProjectionMatrix()
      renderer.autoClear = false
      renderer.clearDepth()
      renderer.render(scene, camera)
      renderer.autoClear = true
    },
  }
}
