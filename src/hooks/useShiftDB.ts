import { useState, useEffect, useCallback } from 'react'
import { ShiftTask } from '@/types/shift'

const DB_NAME = 'ShiftHandoverDB'
const DB_VERSION = 1
const STORE_NAME = 'tasks'

export function useShiftDB() {
  const [db, setDb] = useState<IDBDatabase | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const initDB = () => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => {
        console.error('数据库打开失败')
        setIsLoading(false)
      }

      request.onsuccess = (event) => {
        setDb((event.target as IDBOpenDBRequest).result)
        setIsLoading(false)
      }

      request.onupgradeneeded = (event) => {
        const database = (event.target as IDBOpenDBRequest).result
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'id' })
        }
      }
    }

    initDB()

    return () => {
      if (db) {
        db.close()
      }
    }
  }, [])

  const loadTasks = useCallback((): Promise<ShiftTask[]> => {
    return new Promise((resolve, reject) => {
      if (!db) {
        resolve([])
        return
      }

      const transaction = db.transaction([STORE_NAME], 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.getAll()

      request.onsuccess = () => {
        resolve(request.result || [])
      }

      request.onerror = () => {
        reject(request.error)
      }
    })
  }, [db])

  const saveTasks = useCallback((tasks: ShiftTask[]): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!db) {
        resolve()
        return
      }

      const transaction = db.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)

      store.clear()

      tasks.forEach(task => {
        store.put(task)
      })

      transaction.oncomplete = () => {
        resolve()
      }

      transaction.onerror = () => {
        reject(transaction.error)
      }
    })
  }, [db])

  return { db, isLoading, loadTasks, saveTasks }
}
