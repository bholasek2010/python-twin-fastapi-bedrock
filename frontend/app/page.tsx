import Twin from '@/components/twin';

export default function Home() {
  return (
    <main className='min-h-screen bg-gradient-to-br from-slate-50 to-gray-100'>
      <div className='container px-0 py-0 bg-[#cfcabe]'>
        <div className='max-w-1xl mx-auto bg-[#cfcabe]'>
            <div className='w-[400px] h-[300px] bg-[#cfcabe]'>
              <Twin />
            </div>
          <footer className='mt-8 text-center text-sm text-gray-500'>
            <p></p>
          </footer>
        </div>
      </div>
    </main>
  );
}