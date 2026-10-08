/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#F57B39',   // สีส้มหลัก
          hover: '#E06725',     // สีส้มเข้มตอน Hover
          dark: '#C8561C',      // สีส้มเข้มข้อความ
          light: '#FFF7ED',     // ส้มอ่อนมาก
        },
        surface: {
          bg: '#faf9fd',        // พื้นหลังหลัก
          card: '#ffffff',      // พื้นหลังการ์ด
          subtle: '#f4f3f7',    // พื้นหลังอินพุต/กล่องย่อย
          border: '#e3e2e6',    // เส้นขอบ
          inputBorder: '#c4c6cf',
        },
        text: {
          primary: '#1a1b1e',   // ข้อความหลัก
          secondary: '#44474e', // ข้อความรอง
          muted: '#74777f',     // ข้อความสีเทา
        },
      },
      fontFamily: {
        sans: ['Noto Sans Thai', 'Inter', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
