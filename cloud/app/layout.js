import { Anton, Archivo } from "next/font/google";

const anton = Anton({ weight: "400", subsets: ["latin"], variable: "--font-display" });
const archivo = Archivo({ subsets: ["latin"], variable: "--font-body" });

export const metadata = {
  title: "Instax Multi User Print",
  description: "Take a photo, pick a size, grab your print",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#8CC63E",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${anton.variable} ${archivo.variable}`}
            style={{ margin: 0, background: "#ffffff" }}>
        {children}
      </body>
    </html>
  );
}
