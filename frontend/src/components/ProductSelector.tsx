"use client";

export interface Product {
  id: string;
  name: string;
  category: string;
  description: string;
  imageUrl: string;
}

const MOCK_PRODUCTS: Product[] = [
  {
    id: "prod_1",
    name: "Mid-Century Modern Velvet Sofa",
    category: "Sofa",
    description: "A sleek, mustard yellow velvet sofa with wooden tapered legs.",
    imageUrl: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=400&q=80"
  },
  {
    id: "prod_2",
    name: "Industrial Floor Lamp",
    category: "Lighting",
    description: "Matte black metal floor lamp with an exposed Edison bulb.",
    imageUrl: "https://images.unsplash.com/photo-1513506003901-1e6a229e2d15?auto=format&fit=crop&w=400&q=80"
  },
  {
    id: "prod_3",
    name: "Scandinavian Accent Chair",
    category: "Chair",
    description: "Light oak wood frame with cream boucle fabric upholstery.",
    imageUrl: "https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?auto=format&fit=crop&w=400&q=80"
  }
];

interface ProductSelectorProps {
  onSelect: (product: Product) => void;
}

export default function ProductSelector({ onSelect }: ProductSelectorProps) {
  return (
    <div className="mb-12">
      <h2 className="text-2xl font-semibold mb-6 text-center">Step 1: Choose a Product</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {MOCK_PRODUCTS.map((product) => (
          <div 
            key={product.id}
            onClick={() => onSelect(product)}
            className="border border-slate-200 rounded-xl overflow-hidden cursor-pointer hover:shadow-lg hover:border-blue-400 transition-all bg-white group"
          >
            <div className="h-48 overflow-hidden bg-slate-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img 
                src={product.imageUrl} 
                alt={product.name} 
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
            </div>
            <div className="p-4">
              <span className="text-xs font-bold text-blue-600 uppercase tracking-wider">{product.category}</span>
              <h3 className="font-semibold text-slate-800 mt-1">{product.name}</h3>
              <p className="text-sm text-slate-500 mt-2 line-clamp-2">{product.description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}