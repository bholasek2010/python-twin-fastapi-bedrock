import Twin from '@/components/twin';

export default function Home() {
  return (
    <main className='min-h-screen bg-gradient-to-br from-slate-50 to-gray-100'>
      <div className='container mx-auto px-4 py-8'>
        <div className='max-w-1xl mx-auto'>
          <h1 className='text-4xl font-bold text-center text-gray-800 mb-2'>
            AI on a Page
          </h1>
          <div className="grid grid-cols-3 gap-10 p-2">
            <div className='w-[450px] h-[350px]'>
            <p className='text-lg text-center font-bold text-gray-600 mb-0'>Prompt Chaining</p>
            <p className='text-xs text-center text-gray-600 mb-3'>Frontend:Browser-&gt;CDN-&gt;Static Web
            <br></br>Backend:API Gateway-&gt;Serverless Function-&gt;Managed LLM-&gt;Conversation Memory</p>
              <Twin />
            </div>
            <div className='w-[450px] h-[350px]'>
              <Twin />
            </div>
            <div className='w-[450px] h-[350px]'>
              <Twin />
            </div>
          </div>
          <footer className='mt-8 text-center text-sm text-gray-500'>
            <p></p>
          </footer>
        </div>
      </div>
    </main>
  );
}