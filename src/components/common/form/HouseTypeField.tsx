export interface HouseTypeFieldProps {
  isNewBuild: boolean;
  onChange: (isNewBuild: boolean) => void;
}

export function HouseTypeField({ isNewBuild, onChange }: Readonly<HouseTypeFieldProps>) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Tipo de vivienda</legend>
      <p className="text-xs text-gray-500">Obra nueva 11.2% · A reformar 6.5%</p>
      <div className="flex gap-2">
        <label className="flex items-center gap-2 cursor-pointer py-2 px-3 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 transition-colors text-xs font-medium text-gray-900">
          <input
            type="radio"
            name="houseType"
            checked={isNewBuild}
            onChange={() => onChange(true)}
            className="w-3.5 h-3.5 text-gray-700 border-gray-300 focus:ring-2 focus:ring-gray-500 cursor-pointer"
          />
          Obra nueva
        </label>
        <label className="flex items-center gap-2 cursor-pointer py-2 px-3 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 transition-colors text-xs font-medium text-gray-900">
          <input
            type="radio"
            name="houseType"
            checked={!isNewBuild}
            onChange={() => onChange(false)}
            className="w-3.5 h-3.5 text-gray-700 border-gray-300 focus:ring-2 focus:ring-gray-500 cursor-pointer"
          />
          A reformar
        </label>
      </div>
    </fieldset>
  );
}
