export default function Custom404() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md p-8 text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-2">404</h1>
        <p className="text-gray-600 mb-4">Página no encontrada</p>
        <a href="/" className="text-blue-500 hover:text-blue-600">
          Volver al inicio
        </a>
      </div>
    </div>
  );
}
