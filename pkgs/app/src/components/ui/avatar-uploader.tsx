import * as React from "react";
import Cropper, { type Area, type Point } from "react-easy-crop";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface AvatarUploaderProps {
  children: React.ReactNode;
  onUpload: (file: File) => Promise<{ success: boolean }>;
  aspect?: number;
  maxSizeMB?: number;
  acceptedTypes?: string[];
}

export function AvatarUploader({
  children,
  onUpload,
  aspect = 1,
  maxSizeMB = 20,
  acceptedTypes = ["jpeg", "jpg", "png", "webp"],
}: AvatarUploaderProps) {
  const [crop, setCrop] = React.useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = React.useState<number>(1);
  const [isPending, setIsPending] = React.useState<boolean>(false);
  const [photo, setPhoto] = React.useState<{ url: string; file: File | null }>({
    url: "",
    file: null,
  });
  const [croppedAreaPixels, setCroppedAreaPixels] = React.useState<Area | null>(
    null
  );
  const [open, setOpen] = React.useState<boolean>(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const imgExt = file.name.substring(file.name.lastIndexOf(".") + 1).toLowerCase();
    const validExt = acceptedTypes.includes(imgExt);

    if (!validExt) {
      alert("Selected file is not a supported image type");
      return;
    }
    if (parseFloat(String(file.size)) / (1024 * 1024) >= maxSizeMB) {
      alert("Selected image is too large");
      return;
    }
    setPhoto({ url: URL.createObjectURL(file), file });
  };

  const handleCropComplete = (_: Area, croppedAreaPixels: Area) => {
    setCroppedAreaPixels(croppedAreaPixels);
  };

  const handleUpdate = async () => {
    if (photo?.file && croppedAreaPixels) {
      setIsPending(true);
      try {
        const croppedImg = await getCroppedImg(photo.url, croppedAreaPixels);
        if (!croppedImg?.file) {
          throw new Error("Failed to crop image");
        }

        const file = new File(
          [croppedImg.file],
          photo.file?.name ?? "cropped.jpeg",
          { type: photo.file?.type ?? "image/jpeg" }
        );

        await onUpload(file);
        setPhoto({ url: "", file: null });
        setOpen(false);
      } catch (error) {
        alert(
          error instanceof Error ? error.message : "Failed to update image"
        );
      } finally {
        setIsPending(false);
      }
    } else {
      alert("No image selected for upload");
    }
  };

  return (
    <Modal open={open} onOpenChange={setOpen} drawerProps={{ dismissible: !photo?.file }}>
      <ModalTrigger asChild>{children}</ModalTrigger>
      <ModalContent className="h-max md:max-w-md">
        <ModalHeader>
          <ModalTitle>Upload Image</ModalTitle>
        </ModalHeader>
        <ModalBody className="space-y-2">
          <Input
            disabled={isPending}
            onChange={handleFileChange}
            type="file"
            accept="image/*"
          />
          {photo?.file && (
            <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-zinc-100">
              <Cropper
                image={photo.url}
                crop={crop}
                zoom={zoom}
                aspect={aspect}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={handleCropComplete}
                style={{ containerStyle: { borderRadius: 8 } }}
              />
            </div>
          )}
        </ModalBody>

        <ModalFooter className="grid w-full grid-cols-2 gap-2">
          <Button
            variant="outline"
            disabled={isPending}
            onClick={() => setOpen(false)}
            className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleUpdate}
            disabled={isPending}
          >
            {isPending ? "Uploading..." : "Update"}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", (error) => reject(error));
    image.setAttribute("crossOrigin", "anonymous");
    image.src = url;
  });
}

function getRadianAngle(degreeValue: number): number {
  return (degreeValue * Math.PI) / 180;
}

function rotateSize(
  width: number,
  height: number,
  rotation: number
): { width: number; height: number } {
  const rotRad = getRadianAngle(rotation);
  return {
    width:
      Math.abs(Math.cos(rotRad) * width) + Math.abs(Math.sin(rotRad) * height),
    height:
      Math.abs(Math.sin(rotRad) * width) + Math.abs(Math.cos(rotRad) * height),
  };
}

async function getCroppedImg(
  imageSrc: string,
  pixelCrop: Area,
  rotation = 0
): Promise<{ url: string; file: Blob | null } | null> {
  const image = await createImage(imageSrc);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (!ctx) throw new Error("Failed to create 2D context");

  const { width: bBoxWidth, height: bBoxHeight } = rotateSize(
    image.width,
    image.height,
    rotation
  );

  canvas.width = bBoxWidth;
  canvas.height = bBoxHeight;

  ctx.translate(bBoxWidth / 2, bBoxHeight / 2);
  ctx.rotate(getRadianAngle(rotation));
  ctx.translate(-image.width / 2, -image.height / 2);
  ctx.drawImage(image, 0, 0);

  const data = ctx.getImageData(
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height
  );

  // Resize to max 256px to keep payload small
  const maxDim = 256;
  let outWidth = pixelCrop.width;
  let outHeight = pixelCrop.height;
  if (outWidth > maxDim || outHeight > maxDim) {
    const scale = maxDim / Math.max(outWidth, outHeight);
    outWidth = Math.round(outWidth * scale);
    outHeight = Math.round(outHeight * scale);
  }

  const outCanvas = document.createElement("canvas");
  outCanvas.width = outWidth;
  outCanvas.height = outHeight;
  const outCtx = outCanvas.getContext("2d");
  if (!outCtx) throw new Error("Failed to create 2D context");
  outCtx.drawImage(
    (() => {
      const tmp = document.createElement("canvas");
      tmp.width = pixelCrop.width;
      tmp.height = pixelCrop.height;
      const tmpCtx = tmp.getContext("2d");
      if (tmpCtx) tmpCtx.putImageData(data, 0, 0);
      return tmp;
    })(),
    0,
    0,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    outWidth,
    outHeight
  );

  return new Promise((resolve, reject) => {
    outCanvas.toBlob(
      (file) => {
        if (!file) {
          reject(new Error("Failed to generate cropped image blob"));
          return;
        }
        resolve({ url: URL.createObjectURL(file), file });
      },
      "image/jpeg",
      0.85
    );
  });
}
