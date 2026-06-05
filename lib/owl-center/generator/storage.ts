import type { GeneratorProject } from '@/lib/owl-center/generator/types'

const DB_NAME = 'owl-center-generator'
const STORE = 'projects'
const KEY = 'active-v1'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
  })
}

export async function loadGeneratorProject(): Promise<GeneratorProject | null> {
  if (typeof indexedDB === 'undefined') return null
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(KEY)
    req.onerror = () => reject(req.error ?? new Error('load failed'))
    req.onsuccess = () => resolve((req.result as GeneratorProject | undefined) ?? null)
    tx.oncomplete = () => db.close()
  })
}

export async function saveGeneratorProject(project: GeneratorProject): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put({ ...project, updatedAt: new Date().toISOString() }, KEY)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => reject(tx.error ?? new Error('save failed'))
  })
}

export async function clearGeneratorProject(): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(KEY)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => reject(tx.error ?? new Error('clear failed'))
  })
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

export async function urlToDataUrl(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Fetch failed: ${url}`)
  const blob = await res.blob()
  return fileToDataUrl(new File([blob], 'layer.png', { type: blob.type || 'image/png' }))
}
