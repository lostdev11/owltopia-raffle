'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

type Props = {
  reducedMotion: boolean
  className?: string
}

/**
 * Atmospheric Trading Room backdrop — pods, ring, conduits.
 * Dispose on unmount; pause when hidden / off-screen / reduced-motion.
 */
export function OwlSwapTradingRoomCanvas({ reducedMotion, className }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [webglOk, setWebglOk] = useState(true)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let disposed = false
    let raf = 0
    let renderer: THREE.WebGLRenderer | null = null

    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      })
    } catch {
      setWebglOk(false)
      return
    }

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100)
    camera.position.set(0, 0.15, 4.2)

    renderer.setClearColor(0x000000, 0)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    host.appendChild(renderer.domElement)
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.display = 'block'
    renderer.domElement.setAttribute('aria-hidden', 'true')

    const ambient = new THREE.AmbientLight(0xffffff, 0.35)
    scene.add(ambient)
    const key = new THREE.PointLight(0x00ff88, 1.4, 12)
    key.position.set(-1.6, 0.4, 2)
    scene.add(key)
    const fill = new THREE.PointLight(0xa78bfa, 1.1, 12)
    fill.position.set(1.6, 0.4, 2)
    scene.add(fill)

    const podGeo = new THREE.SphereGeometry(0.72, 32, 32)
    const leftMat = new THREE.MeshStandardMaterial({
      color: 0x0a1f14,
      emissive: 0x00ff88,
      emissiveIntensity: 0.22,
      metalness: 0.35,
      roughness: 0.35,
      transparent: true,
      opacity: 0.55,
    })
    const rightMat = new THREE.MeshStandardMaterial({
      color: 0x140a1f,
      emissive: 0xa78bfa,
      emissiveIntensity: 0.2,
      metalness: 0.35,
      roughness: 0.35,
      transparent: true,
      opacity: 0.55,
    })
    const leftPod = new THREE.Mesh(podGeo, leftMat)
    leftPod.position.set(-1.55, 0.05, 0)
    const rightPod = new THREE.Mesh(podGeo, rightMat)
    rightPod.position.set(1.55, 0.05, 0)
    scene.add(leftPod, rightPod)

    const ringGeo = new THREE.TorusGeometry(0.38, 0.045, 16, 64)
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x00ff88,
      emissive: 0x00ff88,
      emissiveIntensity: 0.65,
      metalness: 0.5,
      roughness: 0.25,
    })
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.rotation.x = Math.PI / 2.4
    scene.add(ring)

    const conduitGeo = new THREE.CylinderGeometry(0.035, 0.035, 1.15, 12)
    const conduitMat = new THREE.MeshStandardMaterial({
      color: 0x00ff88,
      emissive: 0x00ff88,
      emissiveIntensity: 0.4,
      transparent: true,
      opacity: 0.7,
    })
    const leftConduit = new THREE.Mesh(conduitGeo, conduitMat)
    leftConduit.rotation.z = Math.PI / 2
    leftConduit.position.set(-0.75, 0.05, 0)
    const rightConduit = new THREE.Mesh(conduitGeo, conduitMat.clone())
    rightConduit.rotation.z = Math.PI / 2
    rightConduit.position.set(0.75, 0.05, 0)
    scene.add(leftConduit, rightConduit)

    const grid = new THREE.GridHelper(8, 16, 0x113322, 0x0a1510)
    grid.position.y = -1.15
    scene.add(grid)

    const resize = () => {
      if (!renderer || !host) return
      const w = host.clientWidth || 1
      const h = host.clientHeight || 1
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h, false)
    }
    resize()

    const ro = new ResizeObserver(resize)
    ro.observe(host)

    let visible = true
    const io = new IntersectionObserver(
      (entries) => {
        visible = entries.some((e) => e.isIntersecting)
      },
      { threshold: 0.05 }
    )
    io.observe(host)

    const onVisibility = () => {
      /* checked in loop via document.hidden */
    }
    document.addEventListener('visibilitychange', onVisibility)

    const t0 = performance.now()
    const tick = () => {
      if (disposed || !renderer) return
      raf = requestAnimationFrame(tick)
      const paused = document.hidden || !visible || reducedMotion
      if (!paused) {
        const t = (performance.now() - t0) / 1000
        leftPod.position.y = 0.05 + Math.sin(t * 0.9) * 0.04
        rightPod.position.y = 0.05 + Math.sin(t * 0.9 + 1.2) * 0.04
        ring.rotation.z = t * 0.35
      }
      renderer.render(scene, camera)
    }
    raf = requestAnimationFrame(tick)

    const onContextLost = (e: Event) => {
      e.preventDefault()
      setWebglOk(false)
    }
    renderer.domElement.addEventListener('webglcontextlost', onContextLost)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisibility)
      ro.disconnect()
      io.disconnect()
      renderer?.domElement.removeEventListener('webglcontextlost', onContextLost)
      podGeo.dispose()
      leftMat.dispose()
      rightMat.dispose()
      ringGeo.dispose()
      ringMat.dispose()
      conduitGeo.dispose()
      conduitMat.dispose()
      ;(rightConduit.material as THREE.Material).dispose()
      renderer?.dispose()
      if (renderer?.domElement.parentNode === host) {
        host.removeChild(renderer.domElement)
      }
    }
  }, [reducedMotion])

  if (!webglOk) return null

  return <div ref={hostRef} className={className} />
}
