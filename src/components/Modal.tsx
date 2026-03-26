import { useRef, useEffect } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
    isOpen: boolean
    onClose: () => void
    title: string
    children: React.ReactNode
    width?: string
}

export default function Modal({ isOpen, onClose, title, children, width = '560px' }: ModalProps) {
    const overlayRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
        if (isOpen) document.addEventListener('keydown', handleEsc)
        return () => document.removeEventListener('keydown', handleEsc)
    }, [isOpen, onClose])

    if (!isOpen) return null

    return (
        <div className="modal-overlay" ref={overlayRef} onClick={(e) => { if (e.target === overlayRef.current) onClose() }} style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.3)' }}>
            <div className="modal-container" style={{ maxWidth: width, position: 'fixed', right: 0, top: 0, height: '100vh', zIndex: 1000, overflowY: 'auto' }}>
                <div className="modal-header">
                    <h2>{title}</h2>
                    <button className="modal-close" onClick={onClose}><X size={18} /></button>
                </div>
                <div className="modal-body">
                    {children}
                </div>
            </div>
        </div>
    )
}
