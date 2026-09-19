import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, FileText, Image as ImageIcon, Trash2, Plus, Download, 
  Search, RefreshCw, CheckCircle, AlertCircle, Edit3, Store, Calendar, 
  DollarSign, ShoppingBag, Eye, ArrowRight, ShieldAlert, Sparkles, Filter
} from 'lucide-react';

// Script dinámico para cargar pdf.js cuando sea necesario
const loadPdfJs = () => {
  return new Promise((resolve, reject) => {
    if (window.pdfjsLib) {
      resolve(window.pdfjsLib);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve(window.pdfjsLib);
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
};

export default function App() {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [base64Image, setBase64Image] = useState(null);
  const [mimeType, setMimeType] = useState('image/jpeg');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dragActive, setDragActive] = useState(false);

  // Extracted ticket data structure
  const [ticketData, setTicketData] = useState({
    storeName: '',
    purchaseDate: '',
    items: []
  });

  // Table filtering and search
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');

  const fileInputRef = useRef(null);

  // Convierte PDF o Imagen a formato base64 legible por Gemini API
  const handleFileChange = async (selectedFile) => {
    if (!selectedFile) return;

    setError(null);
    setFile(selectedFile);

    const isPdf = selectedFile.type === 'application/pdf' || selectedFile.name.endsWith('.pdf');
    const isImage = selectedFile.type.startsWith('image/');

    if (!isPdf && !isImage) {
      setError('Por favor selecciona una imagen (JPG, PNG, WEBP) o un archivo PDF válido.');
      return;
    }

    try {
      if (isImage) {
        const reader = new FileReader();
        reader.onload = (e) => {
          setPreviewUrl(e.target.result);
          // Remover prefijo data:image/...;base64,
          const base64Str = e.target.result.split(',')[1];
          setBase64Image(base64Str);
          setMimeType(selectedFile.type || 'image/jpeg');
        };
        reader.readAsDataURL(selectedFile);
      } else if (isPdf) {
        setLoading(true);
        // Renderizar la primera página del PDF en un Canvas para obtener base64 PNG
        const pdfjs = await loadPdfJs();
        const arrayBuffer = await selectedFile.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
        const page = await pdf.getPage(1);
        
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: context, viewport }).promise;
        
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        setPreviewUrl(dataUrl);
        setBase64Image(dataUrl.split(',')[1]);
        setMimeType('image/jpeg');
        setLoading(false);
      }
    } catch (err) {
      console.error(err);
      setError('Error al procesar el archivo. Intenta con otra imagen o PDF.');
      setLoading(false);
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const extractTicketInformation = async () => {
    if (!base64Image) {
      setError('Por favor carga una imagen o PDF primero.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const apiKey = ""; // Deja vacío para que el runtime de Canvas provea la API Key requerida
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;

      // Prompt e instrucción de sistema
      const systemPrompt = `Eres un sistema experto en visión por computadora y OCR de recibos de compra.
Extrae la información completa del ticket con alta precisión.
Devuelve el resultado estrictamente en formato JSON siguiendo este esquema exacto:
- storeName: nombre del comercio o establecimiento donde se realizó la compra.
- purchaseDate: fecha de la compra en formato YYYY-MM-DD (o como aparezca si no se identifica el año exacto).
- items: arreglo de objetos con:
  - productName: nombre descriptivo del producto o servicio.
  - code: código de barras, SKU o código de producto registrado en el ticket (si no tiene, escribe "N/A" o déjalo vacío).
  - price: precio de compra individual o total del producto como número flotante (ejemplo 12.50).`;

      const userPrompt = "Analiza esta imagen de un ticket/recibo de compra y extrae todos sus productos, precios, fecha y nombre de la tienda en formato JSON.";

      // Definir schema estricto
      const payload = {
        contents: [
          {
            role: 'user',
            parts: [
              { text: userPrompt },
              {
                inlineData: {
                  mimeType: mimeType,
                  data: base64Image
                }
              }
            ]
          }
        ],
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              storeName: { type: "STRING" },
              purchaseDate: { type: "STRING" },
              items: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    productName: { type: "STRING" },
                    code: { type: "STRING" },
                    price: { type: "NUMBER" }
                  },
                  propertyOrdering: ["productName", "code", "price"]
                }
              }
            },
            propertyOrdering: ["storeName", "purchaseDate", "items"]
          }
        }
      };

      // Implementar llamada con manejo de reintentos e intervalo
      const fetchWithRetry = async (retries = 3, delay = 1000) => {
        try {
          const res = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (!res.ok) {
            throw new Error(`HTTP error! status: ${res.status}`);
          }
          return await res.json();
        } catch (err) {
          if (retries > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay));
            return fetchWithRetry(retries - 1, delay * 2);
          }
          throw err;
        }
      };

      const result = await fetchWithRetry();

      if (
        result.candidates &&
        result.candidates[0]?.content?.parts &&
        result.candidates[0]?.content?.parts[0]?.text
      ) {
        const jsonText = result.candidates[0].content.parts[0].text;
        const parsed = JSON.parse(jsonText);

        setTicketData({
          storeName: parsed.storeName || 'Establecimiento no identificado',
          purchaseDate: parsed.purchaseDate || new Date().toISOString().split('T')[0],
          items: (parsed.items || []).map((item, idx) => ({
            id: Date.now() + idx,
            productName: item.productName || 'Producto',
            code: item.code || 'N/A',
            price: typeof item.price === 'number' ? item.price : parseFloat(item.price) || 0
          }))
        });
      } else {
        throw new Error('No se pudo extraer información clara del recibo.');
      }
    } catch (err) {
      console.error(err);
      setError('Ocurrió un error al procesar el ticket con IA. Verifica que la imagen sea clara e inténtalo nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleItemChange = (id, field, value) => {
    setTicketData((prev) => ({
      ...prev,
      items: prev.items.map((item) => {
        if (item.id === id) {
          return {
            ...item,
            [field]: field === 'price' ? parseFloat(value) || 0 : value
          };
        }
        return item;
      })
    }));
  };

  const handleAddItem = () => {
    setTicketData((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          id: Date.now(),
          productName: 'Nuevo Producto',
          code: 'SKU-' + Math.floor(1000 + Math.random() * 9000),
          price: 0.00
        }
      ]
    }));
  };

  const handleDeleteItem = (id) => {
    setTicketData((prev) => ({
      ...prev,
      items: prev.items.filter((item) => item.id !== id)
    }));
  };

  const exportToCSV = () => {
    if (ticketData.items.length === 0) return;

    const headers = ['Tienda/Lugar', 'Fecha', 'Codigo', 'Nombre del Producto', 'Precio de Compra'];
    const rows = ticketData.items.map(item => [
      `"${ticketData.storeName.replace(/"/g, '""')}"`,
      `"${ticketData.purchaseDate}"`,
      `"${item.code.replace(/"/g, '""')}"`,
      `"${item.productName.replace(/"/g, '""')}"`,
      item.price.toFixed(2)
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `ticket_${ticketData.storeName.toLowerCase().replace(/\s+/g, '_')}_${ticketData.purchaseDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportToJSON = () => {
    if (ticketData.items.length === 0) return;

    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(ticketData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `ticket_${ticketData.storeName.toLowerCase().replace(/\s+/g, '_')}_${ticketData.purchaseDate}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const filteredItems = ticketData.items.filter((item) => {
    const search = searchTerm.toLowerCase();
    return (
      item.productName.toLowerCase().includes(search) ||
      item.code.toLowerCase().includes(search)
    );
  }).sort((a, b) => {
    let comparison = 0;
    if (sortBy === 'name') {
      comparison = a.productName.localeCompare(b.productName);
    } else if (sortBy === 'price') {
      comparison = a.price - b.price;
    } else if (sortBy === 'code') {
      comparison = a.code.localeCompare(b.code);
    }
    return sortOrder === 'asc' ? comparison : -comparison;
  });

  const totalAmount = ticketData.items.reduce((sum, item) => sum + (Number(item.price) || 0), 0);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans p-4 md:p-8">
      {/* Header */}
      <header className="max-w-7xl mx-auto mb-8 flex flex-col md:flex-row md:items-center md:justify-between border-b border-slate-800 pb-5 gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-tr from-indigo-500 to-purple-500 p-3 rounded-2xl shadow-lg shadow-indigo-500/20">
            <Sparkles className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-200 to-indigo-300 bg-clip-text text-transparent">
              OCR Ticket Extractor IA
            </h1>
            <p className="text-sm text-slate-400">
              Extrae automáticamente información de tickets y facturas mediante IA
            </p>
          </div>
        </div>

        {ticketData.items.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={exportToCSV}
              className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-xl border border-slate-700 transition shadow-sm"
            >
              <Download className="w-4 h-4 text-emerald-400" /> Exportar CSV
            </button>
            <button
              onClick={exportToJSON}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-xl transition shadow-lg shadow-indigo-600/30"
            >
              <Download className="w-4 h-4" /> JSON
            </button>
          </div>
        )}
      </header>

      <main className="max-w-7xl mx-auto space-y-8">
        {/* Step 1: File Upload / Drag Zone */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-5 shadow-xl backdrop-blur-sm">
              <h2 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
                <Upload className="w-5 h-5 text-indigo-400" /> Cargar Ticket o Recibo
              </h2>

              <div
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all flex flex-col items-center justify-center min-h-[220px] ${
                  dragActive
                    ? 'border-indigo-500 bg-indigo-500/10 scale-[1.01]'
                    : 'border-slate-700 hover:border-indigo-400/60 bg-slate-900/50 hover:bg-slate-900/80'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png, image/jpeg, image/webp, application/pdf"
                  onChange={(e) => e.target.files?.[0] && handleFileChange(e.target.files[0])}
                  className="hidden"
                />

                {previewUrl ? (
                  <div className="relative w-full flex flex-col items-center gap-3">
                    <div className="max-h-48 overflow-hidden rounded-lg border border-slate-700">
                      <img src={previewUrl} alt="Vista previa" className="object-contain max-h-48 w-full" />
                    </div>
                    <span className="text-xs text-slate-400 font-mono truncate max-w-[200px]">
                      {file?.name}
                    </span>
                    <p className="text-xs text-indigo-400">Haz clic para cambiar de archivo</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <div className="p-4 bg-slate-800 rounded-full border border-slate-700 text-indigo-400">
                      <ImageIcon className="w-8 h-8" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-200">
                        Arrastra tu comprobante o <span className="text-indigo-400 underline">examina</span>
                      </p>
                      <p className="text-xs text-slate-400 mt-1">Soporta PNG, JPG, WEBP o archivos PDF</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Botón de Extracción */}
              <button
                onClick={extractTicketInformation}
                disabled={!base64Image || loading}
                className={`w-full mt-5 py-3 px-4 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all shadow-lg ${
                  !base64Image || loading
                    ? 'bg-slate-700 text-slate-400 cursor-not-allowed opacity-60'
                    : 'bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white shadow-indigo-500/25 active:scale-[0.99]'
                }`}
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" /> Procesando con IA...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" /> Extraer Información del Ticket
                  </>
                )}
              </button>

              {error && (
                <div className="mt-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            {/* Guía Rápida */}
            <div className="bg-slate-800/40 border border-slate-800 rounded-2xl p-5 text-xs text-slate-400 space-y-2">
              <h3 className="text-slate-300 font-semibold text-sm mb-2 flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4 text-emerald-400" /> Consejos para mejor lectura
              </h3>
              <ul className="list-disc list-inside space-y-1 pl-1">
                <li>Asegúrate de que el ticket tenga buena iluminación.</li>
                <li>Procura que el texto no esté borroso o doblado.</li>
                <li>Los códigos de barras/SKU se extraerán si están impresos.</li>
              </ul>
            </div>
          </div>

          {/* Right Column: Dynamic Table & Metrics */}
          <div className="lg:col-span-8 space-y-6">
            {/* Top Metrics Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-slate-800/80 border border-slate-700/80 p-4 rounded-2xl flex items-center gap-4">
                <div className="p-3 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-xl">
                  <DollarSign className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs text-slate-400 font-medium">Total de Compra</p>
                  <p className="text-xl font-extrabold text-slate-100 mt-0.5">
                    ${totalAmount.toFixed(2)}
                  </p>
                </div>
              </div>

              <div className="bg-slate-800/80 border border-slate-700/80 p-4 rounded-2xl flex items-center gap-4">
                <div className="p-3 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-xl">
                  <Store className="w-6 h-6" />
                </div>
                <div className="overflow-hidden">
                  <p className="text-xs text-slate-400 font-medium">Comercio / Lugar</p>
                  <input
                    type="text"
                    value={ticketData.storeName}
                    placeholder="Lugar de compra..."
                    onChange={(e) => setTicketData({ ...ticketData, storeName: e.target.value })}
                    className="bg-transparent text-slate-100 font-semibold text-sm border-b border-transparent hover:border-slate-600 focus:border-indigo-400 focus:outline-none w-full truncate py-0.5"
                  />
                </div>
              </div>

              <div className="bg-slate-800/80 border border-slate-700/80 p-4 rounded-2xl flex items-center gap-4">
                <div className="p-3 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-xl">
                  <Calendar className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs text-slate-400 font-medium">Fecha de Compra</p>
                  <input
                    type="date"
                    value={ticketData.purchaseDate}
                    onChange={(e) => setTicketData({ ...ticketData, purchaseDate: e.target.value })}
                    className="bg-transparent text-slate-100 font-semibold text-sm border-b border-transparent hover:border-slate-600 focus:border-indigo-400 focus:outline-none w-full py-0.5"
                  />
                </div>
              </div>
            </div>

            {/* Dynamic Interactive Table Container */}
            <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-5 shadow-xl backdrop-blur-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <ShoppingBag className="w-5 h-5 text-indigo-400" />
                  <h2 className="text-lg font-semibold text-slate-200">
                    Productos Extraídos ({filteredItems.length})
                  </h2>
                </div>

                <div className="flex items-center gap-3">
                  {/* Search input */}
                  <div className="relative flex-1 sm:w-64">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Buscar producto o código..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full bg-slate-900/80 border border-slate-700 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <button
                    onClick={handleAddItem}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600/80 hover:bg-indigo-600 text-white text-xs font-medium rounded-xl transition shrink-0"
                  >
                    <Plus className="w-4 h-4" /> Agregar Ítem
                  </button>
                </div>
              </div>

              {/* Table rendering */}
              <div className="overflow-x-auto rounded-xl border border-slate-700/80">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-900/90 text-slate-400 text-xs font-semibold uppercase tracking-wider border-b border-slate-700">
                      <th className="py-3 px-4">Código / SKU</th>
                      <th className="py-3 px-4">Nombre del Producto</th>
                      <th className="py-3 px-4 text-right">Precio de Compra</th>
                      <th className="py-3 px-4 text-center w-16">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/60 bg-slate-800/40">
                    {loading ? (
                      Array.from({ length: 4 }).map((_, idx) => (
                        <tr key={idx} className="animate-pulse">
                          <td className="py-3 px-4"><div className="h-4 bg-slate-700 rounded w-16"></div></td>
                          <td className="py-3 px-4"><div className="h-4 bg-slate-700 rounded w-48"></div></td>
                          <td className="py-3 px-4"><div className="h-4 bg-slate-700 rounded w-20 ml-auto"></div></td>
                          <td className="py-3 px-4"><div className="h-4 bg-slate-700 rounded w-8 mx-auto"></div></td>
                        </tr>
                      ))
                    ) : filteredItems.length > 0 ? (
                      filteredItems.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-700/30 transition-colors group">
                          {/* Code Cell */}
                          <td className="py-2.5 px-4 font-mono text-xs">
                            <input
                              type="text"
                              value={item.code}
                              onChange={(e) => handleItemChange(item.id, 'code', e.target.value)}
                              className="bg-transparent border border-transparent hover:border-slate-600 focus:border-indigo-400 focus:bg-slate-900/50 rounded px-2 py-1 text-slate-300 w-full focus:outline-none transition"
                            />
                          </td>

                          {/* Product Name Cell */}
                          <td className="py-2.5 px-4">
                            <input
                              type="text"
                              value={item.productName}
                              onChange={(e) => handleItemChange(item.id, 'productName', e.target.value)}
                              className="bg-transparent border border-transparent hover:border-slate-600 focus:border-indigo-400 focus:bg-slate-900/50 rounded px-2 py-1 text-slate-100 font-medium w-full focus:outline-none transition"
                            />
                          </td>

                          {/* Price Cell */}
                          <td className="py-2.5 px-4 text-right font-mono">
                            <div className="flex items-center justify-end gap-1">
                              <span className="text-slate-400">$</span>
                              <input
                                type="number"
                                step="0.01"
                                value={item.price}
                                onChange={(e) => handleItemChange(item.id, 'price', e.target.value)}
                                className="bg-transparent border border-transparent hover:border-slate-600 focus:border-indigo-400 focus:bg-slate-900/50 rounded px-2 py-1 text-emerald-400 font-semibold w-24 text-right focus:outline-none transition"
                              />
                            </div>
                          </td>

                          {/* Delete Cell */}
                          <td className="py-2.5 px-4 text-center">
                            <button
                              onClick={() => handleDeleteItem(item.id)}
                              className="text-slate-500 hover:text-rose-400 p-1.5 rounded-lg hover:bg-rose-500/10 transition"
                              title="Eliminar producto"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="4" className="py-8 text-center text-slate-500 text-sm">
                          {ticketData.items.length === 0 ? (
                            <div className="flex flex-col items-center gap-2">
                              <FileText className="w-8 h-8 text-slate-600" />
                              <p>Carga una imagen o PDF de un ticket para extraer los datos automáticamente.</p>
                            </div>
                          ) : (
                            <p>No se encontraron productos que coincidan con la búsqueda.</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Table Footer Stats */}
              {ticketData.items.length > 0 && (
                <div className="flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-700/60 gap-2">
                  <p>Puedes hacer clic directamente sobre cualquier celda para corregir los datos.</p>
                  <p className="font-semibold text-slate-300">
                    Total Ítems: <span className="text-indigo-400">{ticketData.items.length}</span>
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}