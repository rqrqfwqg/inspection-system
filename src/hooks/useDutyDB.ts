import { useState, useEffect, useCallback } from 'react'
import { DutySchedule, StaffMember } from '@/types/duty'

const DB_NAME = 'DutyManagementDB'
const DB_VERSION = 1
const SCHEDULES_STORE = 'schedules'
const STAFF_STORE = 'staff'

// IndexedDB 操作封装
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      
      // 创建排班表存储
      if (!db.objectStoreNames.contains(SCHEDULES_STORE)) {
        const scheduleStore = db.createObjectStore(SCHEDULES_STORE, { keyPath: 'id' })
        scheduleStore.createIndex('date', 'date', { unique: false })
        scheduleStore.createIndex('staffId', 'staffId', { unique: false })
        scheduleStore.createIndex('department', 'department', { unique: false })
      }
      
      // 创建员工存储
      if (!db.objectStoreNames.contains(STAFF_STORE)) {
        const staffStore = db.createObjectStore(STAFF_STORE, { keyPath: 'id' })
        staffStore.createIndex('department', 'department', { unique: false })
      }
    }
  })
}

export function useDutyDB() {
  const [db, setDb] = useState<IDBDatabase | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    openDB()
      .then((database) => {
        setDb(database)
        setIsLoading(false)
      })
      .catch((error) => {
        console.error('Failed to open database:', error)
        setIsLoading(false)
      })
  }, [])

  // 获取指定日期的排班
  const getSchedulesByDate = useCallback(async (date: string): Promise<DutySchedule[]> => {
    if (!db) return []
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SCHEDULES_STORE, 'readonly')
      const store = transaction.objectStore(SCHEDULES_STORE)
      const index = store.index('date')
      const request = index.getAll(date)
      
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }, [db])

  // 获取所有员工
  const getAllStaff = useCallback(async (): Promise<StaffMember[]> => {
    if (!db) return []
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STAFF_STORE, 'readonly')
      const store = transaction.objectStore(STAFF_STORE)
      const request = store.getAll()
      
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }, [db])

  // 添加排班
  const addSchedule = useCallback(async (schedule: DutySchedule): Promise<void> => {
    if (!db) return
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SCHEDULES_STORE, 'readwrite')
      const store = transaction.objectStore(SCHEDULES_STORE)
      const request = store.add(schedule)
      
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }, [db])

  // 批量添加排班
  const addSchedules = useCallback(async (schedules: DutySchedule[]): Promise<void> => {
    if (!db) return
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SCHEDULES_STORE, 'readwrite')
      const store = transaction.objectStore(SCHEDULES_STORE)
      
      schedules.forEach(schedule => {
        store.add(schedule)
      })
      
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }, [db])

  // 添加员工
  const addStaff = useCallback(async (staff: StaffMember): Promise<void> => {
    if (!db) return
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STAFF_STORE, 'readwrite')
      const store = transaction.objectStore(STAFF_STORE)
      const request = store.add(staff)
      
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }, [db])

  // 批量添加员工
  const addStaffBatch = useCallback(async (staffList: StaffMember[]): Promise<void> => {
    if (!db) return
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STAFF_STORE, 'readwrite')
      const store = transaction.objectStore(STAFF_STORE)
      
      staffList.forEach(staff => {
        store.add(staff)
      })
      
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }, [db])

  // 清空所有数据
  const clearAll = useCallback(async (): Promise<void> => {
    if (!db) return
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([SCHEDULES_STORE, STAFF_STORE], 'readwrite')
      const scheduleStore = transaction.objectStore(SCHEDULES_STORE)
      const staffStore = transaction.objectStore(STAFF_STORE)
      
      scheduleStore.clear()
      staffStore.clear()
      
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }, [db])

  // 删除排班
  const deleteSchedule = useCallback(async (id: string): Promise<void> => {
    if (!db) return
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SCHEDULES_STORE, 'readwrite')
      const store = transaction.objectStore(SCHEDULES_STORE)
      const request = store.delete(id)
      
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }, [db])

  // 更新排班
  const updateSchedule = useCallback(async (schedule: DutySchedule): Promise<void> => {
    if (!db) return
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SCHEDULES_STORE, 'readwrite')
      const store = transaction.objectStore(SCHEDULES_STORE)
      const request = store.put(schedule)
      
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }, [db])

  return {
    isLoading,
    getSchedulesByDate,
    getAllStaff,
    addSchedule,
    addSchedules,
    addStaff,
    addStaffBatch,
    clearAll,
    deleteSchedule,
    updateSchedule,
  }
}
