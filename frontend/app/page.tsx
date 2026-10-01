import Twin from '@/components/twin';

export default function Home() {
  return (
    <main className='min-h-screen bg-[#cfcabe] from-slate-50 to-gray-100'>
      <div className='container px-0 py-0 '>
        <div className='max-w-1xl mx-auto '>
            <div className='w-[100%] h-[325px] '>
              <Twin />
            </div>
          <footer className='mt-8 text-center text-sm text-gray-500'>
          </footer>
        </div>
      </div>
    </main>
  );
}