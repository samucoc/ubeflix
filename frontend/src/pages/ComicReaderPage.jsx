import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, ArrowLeft, Maximize2, Minimize2,
  BookOpen, Loader, LayoutTemplate, AlignJustify,
} from 'lucide-react';
import { getComicInfo, getComicPageUrl, getComicFileUrl } from '../api';
import * as pdfjsLib from 'pdfjs-dist';

// pdfjs-dist v6 — worker served as static file from /public to avoid Vite asset hashing issues
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

// ── Main component ────────────────────────────────────────────────────────────

export default function ComicReaderPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [comic, setComic] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Reader state
  const [currentPage, setCurrentPage] = useState(0); // 0-indexed
  const [twoPageMode, setTwoPageMode] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);

  // PDF-specific state
  const [pdfDoc, setPdfDoc] = useState(null);
  const canvasRef = useRef(null);
  const canvasRef2 = useRef(null);
  const containerRef = useRef(null);
  const renderTaskRef = useRef(null);

  // Load comic info
  useEffect(() => {
    setLoading(true);
    getComicInfo(id)
      .then((res) => {
        setComic(res.data);
      })
      .catch((err) => {
        setError(err.response?.data?.error || 'Error al cargar el comic');
      })
      .finally(() => setLoading(false));
  }, [id]);

  // Load PDF document
  useEffect(() => {
    if (!comic || comic.format !== 'pdf') return;

    const fileUrl = getComicFileUrl(comic.id);
    pdfjsLib.getDocument({ url: fileUrl }).promise
      .then((doc) => {
        setPdfDoc(doc);
        // Use pdfjs as source of truth for page count (pdf-parse may fail on some PDFs)
        setComic((prev) => ({ ...prev, page_count: doc.numPages }));
      })
      .catch((err) => {
        console.error('PDF load error:', err);
        setError('Error al cargar el PDF: ' + (err.message || err));
      });
  }, [comic?.id, comic?.format]);

  // Render a PDF page to canvas
  const renderPdfPage = useCallback(async (pageIndex, canvas) => {
    if (!pdfDoc || !canvas) return;

    // Cancel any in-progress render on this canvas
    if (renderTaskRef.current) {
      try { renderTaskRef.current.cancel(); } catch { /* ignore */ }
      renderTaskRef.current = null;
    }

    try {
      const page = await pdfDoc.getPage(pageIndex + 1); // pdfjs is 1-indexed
      const viewport = page.getViewport({ scale: 1.5 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      const task = page.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = task;
      await task.promise;
      renderTaskRef.current = null;
    } catch (err) {
      if (err?.name !== 'RenderingCancelledException') {
        console.error('PDF render error:', err);
      }
    }
  }, [pdfDoc]);

  // Render PDF pages when currentPage or pdfDoc changes
  useEffect(() => {
    if (!pdfDoc) return;
    setPageLoading(true);
    const totalPdfPages = pdfDoc.numPages;
    const promises = [renderPdfPage(currentPage, canvasRef.current)];
    if (twoPageMode && currentPage + 1 < totalPdfPages) {
      promises.push(renderPdfPage(currentPage + 1, canvasRef2.current));
    }
    Promise.all(promises).finally(() => setPageLoading(false));
  }, [pdfDoc, currentPage, twoPageMode, renderPdfPage]);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown') {
        goNext();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        goPrev();
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen();
      } else if (e.key === 'Escape' && fullscreen) {
        exitFullscreen();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  // Fullscreen API listeners
  useEffect(() => {
    const handleFsChange = () => {
      setFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const totalPages = comic?.page_count || 0;
  const pageStep = twoPageMode ? 2 : 1;

  const goNext = useCallback(() => {
    setCurrentPage((p) => Math.min(p + pageStep, totalPages - 1));
  }, [pageStep, totalPages]);

  const goPrev = useCallback(() => {
    setCurrentPage((p) => Math.max(p - pageStep, 0));
  }, [pageStep]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement && containerRef.current) {
      containerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  const exitFullscreen = useCallback(() => {
    document.exitFullscreen().catch(() => {});
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div className="spinner" />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 16 }}>
        <BookOpen size={64} style={{ color: 'var(--text-muted)' }} />
        <p style={{ color: '#ef4444' }}>{error}</p>
        <button className="btn btn-secondary" onClick={() => navigate('/comics')}>
          <ArrowLeft size={16} /> Volver
        </button>
      </div>
    );
  }

  const isPdf = comic?.format === 'pdf';

  const pageLabel = twoPageMode && currentPage + 1 < totalPages
    ? `${currentPage + 1} – ${currentPage + 2} / ${totalPages}`
    : `${currentPage + 1} / ${totalPages}`;

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: '#0a0a0a',
        color: '#fff',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* ── Top bar ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 16px',
        background: 'rgba(0,0,0,0.8)',
        borderBottom: '1px solid #222',
        flexShrink: 0,
        zIndex: 10,
      }}>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => navigate('/comics')}
          title="Volver a Comics"
        >
          <ArrowLeft size={16} />
        </button>

        <span style={{ flex: 1, fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {comic?.title}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Page counter */}
          <span style={{ fontSize: 13, color: '#aaa', minWidth: 80, textAlign: 'center' }}>
            {totalPages > 0 ? pageLabel : '...'}
          </span>

          {/* Two-page toggle */}
          <button
            className={`btn btn-sm ${twoPageMode ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => { setTwoPageMode((v) => !v); setCurrentPage((p) => p % 2 === 0 ? p : p - 1); }}
            title={twoPageMode ? 'Página simple' : 'Doble página'}
          >
            {twoPageMode ? <LayoutTemplate size={15} /> : <AlignJustify size={15} />}
          </button>

          {/* Fullscreen */}
          <button
            className="btn btn-secondary btn-sm"
            onClick={toggleFullscreen}
            title={fullscreen ? 'Salir de pantalla completa (F)' : 'Pantalla completa (F)'}
          >
            {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        </div>
      </div>

      {/* ── Page viewer ── */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          overflow: 'hidden',
        }}
        onClick={(e) => {
          // Click left half → prev, right half → next
          const rect = e.currentTarget.getBoundingClientRect();
          if (e.clientX < rect.left + rect.width / 2) {
            goPrev();
          } else {
            goNext();
          }
        }}
      >
        {/* Prev arrow */}
        <button
          onClick={(e) => { e.stopPropagation(); goPrev(); }}
          disabled={currentPage === 0}
          style={{
            position: 'absolute', left: 12, zIndex: 5,
            background: 'rgba(0,0,0,0.5)', border: 'none', borderRadius: '50%',
            width: 44, height: 44, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: currentPage === 0 ? '#444' : '#fff',
            transition: 'background 0.2s',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.8)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.5)'}
        >
          <ChevronLeft size={24} />
        </button>

        {/* Page content */}
        <div style={{
          display: 'flex',
          gap: 2,
          maxHeight: '100%',
          maxWidth: '100%',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {isPdf ? (
            <>
              <canvas
                ref={canvasRef}
                style={{ maxHeight: 'calc(100vh - 60px)', maxWidth: twoPageMode ? '50vw' : '100vw', objectFit: 'contain' }}
              />
              {twoPageMode && currentPage + 1 < totalPages && (
                <canvas
                  ref={canvasRef2}
                  style={{ maxHeight: 'calc(100vh - 60px)', maxWidth: '50vw', objectFit: 'contain' }}
                />
              )}
            </>
          ) : (
            <>
              <PageImage
                key={`page-${currentPage}`}
                comicId={id}
                pageIndex={currentPage}
                style={{ maxHeight: 'calc(100vh - 60px)', maxWidth: twoPageMode ? '50vw' : '92vw', objectFit: 'contain' }}
                onLoadStart={() => setPageLoading(true)}
                onLoad={() => setPageLoading(false)}
              />
              {twoPageMode && currentPage + 1 < totalPages && (
                <PageImage
                  key={`page-${currentPage + 1}`}
                  comicId={id}
                  pageIndex={currentPage + 1}
                  style={{ maxHeight: 'calc(100vh - 60px)', maxWidth: '50vw', objectFit: 'contain' }}
                />
              )}
            </>
          )}

          {pageLoading && (
            <div style={{
              position: 'absolute',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(0,0,0,0.5)', borderRadius: 8, padding: 16,
            }}>
              <Loader size={32} style={{ animation: 'spin 1s linear infinite' }} />
            </div>
          )}
        </div>

        {/* Next arrow */}
        <button
          onClick={(e) => { e.stopPropagation(); goNext(); }}
          disabled={currentPage + pageStep >= totalPages}
          style={{
            position: 'absolute', right: 12, zIndex: 5,
            background: 'rgba(0,0,0,0.5)', border: 'none', borderRadius: '50%',
            width: 44, height: 44, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: currentPage + pageStep >= totalPages ? '#444' : '#fff',
            transition: 'background 0.2s',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.8)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.5)'}
        >
          <ChevronRight size={24} />
        </button>
      </div>

      {/* ── Progress bar ── */}
      {totalPages > 0 && (
        <div style={{
          height: 3,
          background: '#222',
          flexShrink: 0,
        }}>
          <div style={{
            height: '100%',
            width: `${((currentPage + 1) / totalPages) * 100}%`,
            background: 'var(--primary, #6366f1)',
            transition: 'width 0.3s',
          }} />
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

// ── PageImage component (for archive comics) ──────────────────────────────────

function PageImage({ comicId, pageIndex, style, onLoadStart, onLoad }) {
  const [src, setSrc] = useState('');
  const [err, setErr] = useState(false);

  useEffect(() => {
    setSrc(getComicPageUrl(comicId, pageIndex));
    setErr(false);
    if (onLoadStart) onLoadStart();
  }, [comicId, pageIndex]);

  if (err) {
    return (
      <div style={{
        ...style,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#111', color: '#555',
        minWidth: 200, minHeight: 300,
      }}>
        <BookOpen size={40} />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={`Página ${pageIndex + 1}`}
      style={{ ...style, display: 'block' }}
      onLoad={onLoad}
      onError={() => { setErr(true); if (onLoad) onLoad(); }}
      draggable={false}
    />
  );
}
